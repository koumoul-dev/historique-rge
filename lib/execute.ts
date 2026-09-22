import type { RunFunction, ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'
import type { CurrentState, PreviousState } from './types.ts'
import { lineKey } from './types.ts'
import { today as parisToday } from './dates.ts'
import { diff } from './diff.ts'
import { bulkLines } from './data-fair.ts'
import { checkHistoryDataset, countCurrentLines, readHistoryState } from './history.ts'
import { chooseStrategy, getSourceInfo, readSourceFull, readSourceIncremental, sinceFrom, type Mode, type SourceInfo, type Strategy } from './sources.ts'

let shouldBeStopped = false
export const isStopped = () => shouldBeStopped
export const stop = async () => { shouldBeStopped = true }

// above this share of the organism's current lines, reading the whole history state beats siret_in batches
const fullHistoryReadRatio = 0.01

type Plan = { info: SourceInfo, strategy: Strategy }

export const run: RunFunction<ProcessingConfig> = async (context) => {
  shouldBeStopped = false
  const { processingConfig: config, axios, log } = context
  const today = parisToday()
  const organisme = config.organisme
  const state = config.state ?? {}

  const history = await checkHistoryDataset(axios, config.dataset, log)

  const plans: Plan[] = []
  for (const ref of config.sourceDatasets) {
    const info = await getSourceInfo(axios, ref, log)
    plans.push({ info, strategy: chooseStrategy(config.mode as Mode, info, state[info.id]?.cursor) })
  }
  if (isStopped()) return

  // the history does not know which source a key comes from: one full source means a full run
  let strategy: Strategy = plans.every(p => p.strategy === 'incremental') ? 'incremental' : 'full'
  await log.step(`Loading the ${strategy} state of ${organisme}`)

  let current: CurrentState = new Map()
  let touchedKeys: Set<string> | undefined

  if (strategy === 'incremental') {
    touchedKeys = new Set()
    for (const { info } of plans) {
      const since = sinceFrom(state[info.id]!.cursor!)
      const res = await readSourceIncremental(axios, info, since, log, isStopped)
      if (isStopped()) return
      if (!res.covered) {
        await log.warning(`the revisions of ${info.title} do not cover the period since ${since}, switching to a full run`)
        strategy = 'full'
        break
      }
      for (const line of res.modified) {
        const key = lineKey(line)
        current.set(key, line)
        touchedKeys.add(key)
      }
      for (const key of res.deletedKeys) if (!current.has(key)) touchedKeys.add(key)
      await log.info(`${info.title}: ${res.modified.length} line(s) modified, ${res.deletedKeys.size} deleted since ${since}`)
    }
  }

  if (strategy === 'full') {
    current = new Map()
    touchedKeys = undefined
    for (const { info } of plans) {
      for (const line of await readSourceFull(axios, info, log, isStopped)) {
        const key = lineKey(line)
        if (current.has(key)) throw new Error(`duplicate key ${key} in the source datasets`)
        current.set(key, line)
      }
      if (isStopped()) return
    }
    await log.info(`${current.size} line(s) in the source datasets`)
  }

  let previous: PreviousState
  if (touchedKeys) {
    const total = await countCurrentLines(axios, history.id, organisme)
    const sirets = [...new Set([...touchedKeys].map(key => key.split('|')[0]))]
    const readAll = touchedKeys.size > total * fullHistoryReadRatio
    previous = await readHistoryState(axios, history.id, organisme, today, log, isStopped, readAll ? undefined : sirets)
  } else {
    previous = await readHistoryState(axios, history.id, organisme, today, log, isStopped)
  }
  if (isStopped()) return

  await log.step('Computing the changes')
  const { ops, stats } = diff(previous, current, organisme, today, touchedKeys)
  await log.info(`changes: created=${stats.created}, closed=${stats.closed}, updated=${stats.updated}, reopened=${stats.reopened}, deleted=${stats.deleted}, unchanged=${stats.unchanged}`)
  if (isStopped()) return

  if (ops.length) {
    await log.step(`Writing ${ops.length} operation(s) in the history`)
    const result = await bulkLines(axios, history.id, ops, log, isStopped)
    if (isStopped()) return
    await log.info(`written: ok=${result.nbOk}, not modified=${result.nbNotModified}, already handled=${result.nbMissing}`)
  }

  await saveCursors(context, plans)
}

// the cursor is the source dataUpdatedAt seen at the start of the run: anything written later is re-examined next time
const saveCursors = async (context: ProcessingContext<ProcessingConfig>, plans: Plan[]) => {
  const state = { ...(context.processingConfig.state ?? {}) }
  for (const { info } of plans) {
    if (info.dataUpdatedAt) state[info.id] = { cursor: info.dataUpdatedAt }
  }
  // patchConfig is typed for the datasetMode switch only, but patches any config property
  await context.patchConfig({ state } as any)
}
