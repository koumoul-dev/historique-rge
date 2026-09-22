import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import type { SourceKey, SourceLine } from './types.ts'
import { optionalSourceKeys, sourceKeys } from './types.ts'
import { getDataset, readAllLines, waitForIndexed } from './data-fair.ts'
import { readDeletedSince } from './revisions.ts'

/**
 * `restHistory` is the raw dataset setting, `hasHistory` is true only when the revisions are usable (primary key on siret + code_qualification),
 * `keys` are the source columns actually present (optional ones may be missing).
 */
export type SourceInfo = { id: string, title: string, isRest: boolean, restHistory: boolean, hasHistory: boolean, dataUpdatedAt?: string, keys: SourceKey[] }
export type Strategy = 'full' | 'incremental'
export type Mode = 'auto' | 'full' | 'incremental'

export const overlapMs = 15 * 60 * 1000
export const sinceFrom = (cursor: string): string => new Date(new Date(cursor).getTime() - overlapMs).toISOString()

export const getSourceInfo = async (axios: AxiosInstance, ref: { id: string, title?: string }, log: LogFunctions): Promise<SourceInfo> => {
  await log.step(`Checking source dataset "${ref.title ?? ref.id}"`)
  const dataset = await getDataset(axios, ref.id)
  const schemaKeys = new Set(dataset.schema.map(p => p.key))
  const missing = sourceKeys.filter(key => !schemaKeys.has(key))
  for (const key of missing) {
    if (!optionalSourceKeys.includes(key)) throw new Error(`missing column "${key}" in the source dataset ${dataset.id}`)
  }
  if (missing.length) await log.warning(`optional column(s) absent from ${dataset.title} (${dataset.id}), read as empty: ${missing.join(', ')}`)
  const keys = sourceKeys.filter(key => schemaKeys.has(key))
  // a write may still be indexing when the webhook fires: wait for it, the run is useless otherwise
  const indexed = await waitForIndexed(axios, ref.id, log)
  // a deleted revision only keeps the primary key fields: without them the deletions cannot be matched to the history
  const restHistory = !!dataset.rest?.history
  const primaryKey = dataset.primaryKey ?? []
  const hasPrimaryKey = primaryKey.includes('siret') && primaryKey.includes('code_qualification')
  if (restHistory && !hasPrimaryKey) {
    await log.warning(`the line history of ${dataset.title} (${dataset.id}) cannot be used: its primary key must contain siret and code_qualification (found: ${primaryKey.join(', ') || 'none'})`)
  }
  const info: SourceInfo = { id: dataset.id, title: dataset.title, isRest: !!dataset.isRest, restHistory, hasHistory: restHistory && hasPrimaryKey, dataUpdatedAt: indexed.dataUpdatedAt, keys }
  await log.info(`source dataset ok, ${info.title} (${info.id}), ${info.isRest ? 'editable' : 'file'}${info.hasHistory ? ' with line history' : ''}, data updated at ${info.dataUpdatedAt}`)
  return info
}

export const chooseStrategy = (mode: Mode, info: SourceInfo, cursor?: string): Strategy => {
  if (mode === 'full') return 'full'
  if (mode === 'incremental') {
    if (!info.isRest) throw new Error(`incremental mode is impossible: ${info.title} is not an editable dataset`)
    if (!info.restHistory) throw new Error(`incremental mode is impossible: ${info.title} has no line history`)
    if (!info.hasHistory) throw new Error(`incremental mode is impossible: ${info.title} has no primary key on siret and code_qualification`)
  }
  if (!info.isRest || !info.hasHistory || !cursor) return 'full'
  return 'incremental'
}

const linesUrl = (info: SourceInfo) => `api/v1/datasets/${info.id}/lines`

export const readSourceFull = async (axios: AxiosInstance, info: SourceInfo, log: LogFunctions, isStopped: () => boolean): Promise<SourceLine[]> =>
  readAllLines<SourceLine>(axios, linesUrl(info), { size: 10000, select: info.keys.join(',') }, log, `Reading all lines of ${info.title}`, isStopped)

export const readSourceIncremental = async (axios: AxiosInstance, info: SourceInfo, since: string, log: LogFunctions, isStopped: () => boolean) => {
  const modified = await readAllLines<SourceLine>(axios, linesUrl(info), { size: 10000, select: [...info.keys, '_updatedAt'].join(','), _updatedAt_gte: since }, log, `Reading lines of ${info.title} updated since ${since}`, isStopped)
  const { deletedKeys, covered } = await readDeletedSince(axios, info.id, since, log, isStopped)
  return { modified, deletedKeys, covered }
}
