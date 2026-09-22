import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import type { SourceLine } from './types.ts'
import { sourceKeys } from './types.ts'
import { getDataset, readAllLines, waitForIndexed } from './data-fair.ts'
import { readDeletedSince } from './revisions.ts'

export type SourceInfo = { id: string, title: string, isRest: boolean, hasHistory: boolean, dataUpdatedAt?: string }
export type Strategy = 'full' | 'incremental'
export type Mode = 'auto' | 'full' | 'incremental'

export const overlapMs = 15 * 60 * 1000
export const sinceFrom = (cursor: string): string => new Date(new Date(cursor).getTime() - overlapMs).toISOString()

export const getSourceInfo = async (axios: AxiosInstance, ref: { id: string, title?: string }, log: LogFunctions): Promise<SourceInfo> => {
  await log.step(`Checking source dataset "${ref.title ?? ref.id}"`)
  const dataset = await getDataset(axios, ref.id)
  const keys = new Set(dataset.schema.map(p => p.key))
  for (const key of sourceKeys) {
    if (!keys.has(key)) throw new Error(`missing column "${key}" in the source dataset ${dataset.id}`)
  }
  // a write may still be indexing when the webhook fires: wait for it, the run is useless otherwise
  const indexed = await waitForIndexed(axios, ref.id, log)
  const info: SourceInfo = { id: dataset.id, title: dataset.title, isRest: !!dataset.isRest, hasHistory: !!dataset.rest?.history, dataUpdatedAt: indexed.dataUpdatedAt }
  await log.info(`source dataset ok, ${info.title} (${info.id}), ${info.isRest ? 'editable' : 'file'}${info.hasHistory ? ' with line history' : ''}, data updated at ${info.dataUpdatedAt}`)
  return info
}

export const chooseStrategy = (mode: Mode, info: SourceInfo, cursor?: string): Strategy => {
  if (mode === 'full') return 'full'
  if (mode === 'incremental') {
    if (!info.isRest) throw new Error(`incremental mode is impossible: ${info.title} is not an editable dataset`)
    if (!info.hasHistory) throw new Error(`incremental mode is impossible: ${info.title} has no line history`)
  }
  if (!info.isRest || !info.hasHistory || !cursor) return 'full'
  return 'incremental'
}

const linesUrl = (info: SourceInfo) => `api/v1/datasets/${info.id}/lines`

export const readSourceFull = async (axios: AxiosInstance, info: SourceInfo, log: LogFunctions, isStopped: () => boolean): Promise<SourceLine[]> =>
  readAllLines<SourceLine>(axios, linesUrl(info), { size: 10000, select: sourceKeys.join(',') }, log, `Reading all lines of ${info.title}`, isStopped)

export const readSourceIncremental = async (axios: AxiosInstance, info: SourceInfo, since: string, log: LogFunctions, isStopped: () => boolean) => {
  const modified = await readAllLines<SourceLine>(axios, linesUrl(info), { size: 10000, select: [...sourceKeys, '_updatedAt'].join(','), _updatedAt_gte: since }, log, `Reading lines of ${info.title} updated since ${since}`, isStopped)
  const { deletedKeys, covered } = await readDeletedSince(axios, info.id, since, log, isStopped)
  return { modified, deletedKeys, covered }
}
