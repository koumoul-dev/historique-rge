import { strict as assert } from 'node:assert'
import type { AxiosInstance } from 'axios'
import { describe, it } from 'node:test'
import { existsSync } from 'node:fs'
import testUtils from '@data-fair/lib-processing-dev/tests-utils.js'
import * as plugin from '../index.ts'
import historySchema from '../resources/schema.json' with { type: 'json' }
import { sourceKeys } from '../lib/types.ts'
import { getDataset, waitForIndexed } from '../lib/data-fair.ts'
import { overlapMs } from '../lib/sources.ts'

// Runs against a real data-fair instance described in config/local-test.mjs.
const hasLocalConfig = existsSync(new URL('../config/local-test.mjs', import.meta.url))

type Dataset = { id: string, title: string }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// the staging worker can lag by minutes: every wait on it gets the same generous budget as the plugin
const waitBudgetMs = 5 * 60 * 1000

// a freshly created dataset is not writable before its status reaches finalized
const waitForFinalized = async (axios: AxiosInstance, id: string) => {
  const start = Date.now()
  while (Date.now() - start < waitBudgetMs) {
    const { status } = (await axios.get<{ status: string }>(`api/v1/datasets/${id}`)).data
    if (status === 'finalized') return
    await sleep(2000)
  }
  throw new Error(`dataset ${id} is not finalized after ${waitBudgetMs / 1000} s`)
}

// data-fair keeps serving a memoized dataset document after a line write until the finalize pass
// bumps finalizedAt (its freshness check ignores dataUpdatedAt): wait for that pass before reading
const waitForFinalizeAfter = async (axios: AxiosInstance, id: string, previousFinalizedAt: string | undefined) => {
  const start = Date.now()
  while (Date.now() - start < waitBudgetMs) {
    const { finalizedAt } = await getDataset(axios, id)
    if (finalizedAt && (!previousFinalizedAt || finalizedAt > previousFinalizedAt)) return
    await sleep(2000)
  }
  throw new Error(`dataset ${id} was not finalized again within ${waitBudgetMs / 1000} s`)
}

const createHistory = async (axios: AxiosInstance) => (await axios.post<Dataset>('api/v1/datasets', {
  title: 'historique-rge test history',
  isRest: true,
  primaryKey: ['organisme', 'siret', 'code_qualification', 'date_debut'],
  schema: historySchema
})).data

// the history is indexed asynchronously: poll until the expected state shows up, then return the last read
const readHistoryUntil = async (axios: AxiosInstance, historyId: string, expected: (lines: any[], current: any[]) => boolean) => {
  let lines: any[] = []
  let current: any[] = []
  const start = Date.now()
  for (let i = 0; Date.now() - start < waitBudgetMs && !expected(lines, current); i++) {
    if (i) await sleep(2000)
    lines = (await axios.get(`api/v1/datasets/${historyId}/lines`, { params: { size: 100, organisme_eq: 'opqtecc' } })).data.results
    current = lines.filter((l: any) => l.traitement_termine === false)
  }
  return { lines, current }
}

const csvHeader = sourceKeys.join(',')
const uploadCsv = async (axios: AxiosInstance, rows: string[], datasetId?: string) => {
  const form = new FormData()
  form.append('file', new Blob([[csvHeader, ...rows].join('\n') + '\n'], { type: 'text/csv' }), 'rge.csv')
  if (!datasetId) form.append('title', 'historique-rge test file source')
  return (await axios.post<Dataset & { finalizedAt?: string }>(datasetId ? `api/v1/datasets/${datasetId}` : 'api/v1/datasets', form)).data
}

const deleteAll = async (axios: AxiosInstance, log: { error: (msg: string) => Promise<void> }, datasets: (Dataset | undefined)[]) => {
  for (const dataset of datasets) {
    if (!dataset) continue
    try {
      await axios.delete(`api/v1/datasets/${dataset.id}`)
    } catch (err: any) {
      await log.error(`failed to delete the test dataset ${dataset.id}: ${err.status ?? err.message}`).catch(() => {})
    }
  }
}

describe('integration', { skip: !hasLocalConfig && 'no config/local-test.mjs' }, () => {
  it('synchronises a source into a history, full then incremental', async () => {
    const config = (await import('#config')).default
    const context = testUtils.context({
      pluginConfig: {},
      processingConfig: { dataset: { id: '', title: '' }, sourceDatasets: [], organisme: 'opqtecc', mode: 'auto' }
    }, config, false)
    const { axios } = context
    const warnings: string[] = []
    const originalWarning = context.log.warning
    context.log.warning = async (msg, extra) => { warnings.push(msg); return originalWarning(msg, extra) }

    let source: Dataset | undefined
    let history: Dataset | undefined
    try {
      source = (await axios.post<Dataset>('api/v1/datasets', {
        title: 'historique-rge test source',
        isRest: true,
        rest: { history: true },
        primaryKey: ['siret', 'code_qualification'],
        schema: sourceKeys.map(key => ({ key, type: ['latitude', 'longitude'].includes(key) ? 'number' : key === 'particulier' ? 'boolean' : 'string' }))
      })).data
      history = await createHistory(axios)
      context.processingConfig.dataset = { id: history.id, title: history.title }
      context.processingConfig.sourceDatasets = [{ id: source.id, title: source.title }]
      await waitForFinalized(axios, source.id)
      await waitForFinalized(axios, history.id)

      let finalizedBefore = (await getDataset(axios, source.id)).finalizedAt
      await axios.post(`api/v1/datasets/${source.id}/_bulk_lines`, [
        { siret: '11111111111111', code_qualification: 'A', nom_entreprise: 'One', lien_date_debut: '2025-01-01', lien_date_fin: '2027-01-01' },
        { siret: '22222222222222', code_qualification: 'A', nom_entreprise: 'Two', lien_date_debut: '2025-01-01', lien_date_fin: '2027-01-01' }
      ])
      await waitForFinalizeAfter(axios, source.id, finalizedBefore)
      await waitForIndexed(axios, source.id, context.log)
      await plugin.run(context)
      assert.ok(context.processingConfig.state?.[source.id]?.cursor, 'a cursor is stored after the first run')
      const firstWriteAt = (await getDataset(axios, source.id)).dataUpdatedAt!

      // the second write must be stamped after firstWriteAt + 1 s (server time, no dependence on the local clock)
      await sleep(2000)
      finalizedBefore = (await getDataset(axios, source.id)).finalizedAt
      await axios.post(`api/v1/datasets/${source.id}/_bulk_lines`, [
        { _action: 'patch', siret: '11111111111111', code_qualification: 'A', nom_entreprise: 'One updated' },
        { _action: 'delete', siret: '22222222222222', code_qualification: 'A' }
      ])
      await waitForFinalizeAfter(axios, source.id, finalizedBefore)
      await waitForIndexed(axios, source.id, context.log)
      // the run is incremental only if a revision is older than cursor - overlap: place that boundary between the two writes
      context.processingConfig.state[source.id].cursor = new Date(new Date(firstWriteAt).getTime() + 1000 + overlapMs).toISOString()
      await plugin.run(context)
      assert.ok(!warnings.some(msg => msg.includes('do not cover')), `the second run fell back to full: ${warnings.join(' | ')}`)
      assert.equal(context.processingConfig.state[source.id].cursor, (await getDataset(axios, source.id)).dataUpdatedAt, 'the cursor is the source dataUpdatedAt')

      const { lines, current } = await readHistoryUntil(axios, history.id, (lines, current) => lines.length === 1 && current.length === 1 && current[0].nom_entreprise === 'One updated')
      // same-day rule: line 1 patched in place, line 2 deleted (opened and closed today)
      assert.equal(current.length, 1, `current lines: ${JSON.stringify(lines)}`)
      assert.equal(current[0].nom_entreprise, 'One updated')
      assert.equal(lines.length, 1, `history lines: ${JSON.stringify(lines)}`)
    } finally {
      await deleteAll(axios, context.log, [source, history])
    }
  })

  it('synchronises a file source into a history, upload after upload', async () => {
    const config = (await import('#config')).default
    const context = testUtils.context({
      pluginConfig: {},
      processingConfig: { dataset: { id: '', title: '' }, sourceDatasets: [], organisme: 'opqtecc', mode: 'auto' }
    }, config, false)
    const { axios } = context
    const warnings: string[] = []
    const originalWarning = context.log.warning
    context.log.warning = async (msg, extra) => { warnings.push(msg); return originalWarning(msg, extra) }

    const row = (siret: string, name: string, email: string) => [siret, name, '1 rue A', '75001', 'PARIS', '48.8', '2.3', '01 02 03 04 05', email, 'https://one.fr', 'A', 'Isolation', 'https://q/1', 'cert', 'D', 'MD', 'true', '2025-01-01', '2027-01-01'].join(',')

    let source: Dataset | undefined
    let history: Dataset | undefined
    try {
      history = await createHistory(axios)
      source = await uploadCsv(axios, [row('11111111111111', 'One', 'a@one.fr'), row('22222222222222', 'Two', 'b@two.fr')])
      context.processingConfig.dataset = { id: history.id, title: history.title }
      context.processingConfig.sourceDatasets = [{ id: source.id, title: source.title }]
      await waitForFinalized(axios, history.id)
      await waitForFinalized(axios, source.id)

      // data-fair infers integers for siret, code_postal and telephone: the ADEME datasets force strings
      const finalizedBefore = (await getDataset(axios, source.id)).finalizedAt
      const schema = (await getDataset(axios, source.id)).schema.filter(p => !p.key.startsWith('_'))
        .map(p => ['siret', 'code_postal', 'telephone'].includes(p.key) ? { ...p, 'x-transform': { type: 'string' } } : p)
      await axios.patch(`api/v1/datasets/${source.id}`, { schema })
      await waitForFinalizeAfter(axios, source.id, finalizedBefore)
      await waitForIndexed(axios, source.id, context.log)

      await plugin.run(context)
      const firstCursor = context.processingConfig.state?.[source.id]?.cursor
      assert.ok(firstCursor, 'a cursor is stored after the first run')
      const first = await readHistoryUntil(axios, history.id, (lines, current) => current.length === 2)
      assert.equal(first.current.length, 2, `current lines: ${JSON.stringify(first.lines)}`)
      assert.equal(first.current.find((l: any) => l.siret === '11111111111111')?.email, 'a@one.fr')

      // new upload: line 1 changed, line 2 gone, email column entirely empty (data-fair drops it from the schema)
      await sleep(1000)
      await uploadCsv(axios, [row('11111111111111', 'One updated', '')], source.id)
      const uploadStart = Date.now()
      while (Date.now() - uploadStart < waitBudgetMs) {
        const { dataUpdatedAt, finalizedAt } = await getDataset(axios, source.id)
        if (dataUpdatedAt && dataUpdatedAt > firstCursor && finalizedAt && finalizedAt >= dataUpdatedAt) break
        await sleep(2000)
      }
      await plugin.run(context)
      assert.ok(warnings.some(msg => msg.includes('optional column')), `the dropped email column is tolerated: ${warnings.join(' | ')}`)
      assert.ok(context.processingConfig.state![source.id].cursor! > firstCursor, 'the cursor moved with the upload')

      const { lines, current } = await readHistoryUntil(axios, history.id, (lines, current) => lines.length === 1 && current.length === 1 && current[0].nom_entreprise === 'One updated')
      // same-day rule: line 1 patched in place (email emptied), line 2 deleted
      assert.equal(current.length, 1, `current lines: ${JSON.stringify(lines)}`)
      assert.equal(current[0].nom_entreprise, 'One updated')
      assert.equal(current[0].email, undefined, 'the emptied email is removed from the line')
      assert.equal(lines.length, 1, `history lines: ${JSON.stringify(lines)}`)
    } finally {
      await deleteAll(axios, context.log, [source, history])
    }
  })
})
