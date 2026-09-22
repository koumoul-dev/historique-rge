import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import type { HistoryLine, PreviousState } from './types.ts'
import { lineKey, primaryKey } from './types.ts'
import { dayBefore } from './dates.ts'
import { getDataset, readAllLines, waitForIndexed, type DatasetInfo } from './data-fair.ts'
import schema from '../resources/schema.json' with { type: 'json' }

export const historyKeys: string[] = schema.map(p => p.key)

export const checkHistoryDataset = async (axios: AxiosInstance, ref: { id: string, title?: string }, log: LogFunctions): Promise<DatasetInfo> => {
  await log.step(`Checking history dataset "${ref.title ?? ref.id}"`)
  const dataset = await getDataset(axios, ref.id)
  if (!dataset.isRest) throw new Error(`the history dataset ${dataset.id} must be an editable (REST) dataset`)
  const keys = new Set(dataset.schema.map(p => p.key))
  for (const key of historyKeys) {
    if (!keys.has(key)) throw new Error(`missing column "${key}" in the history dataset ${dataset.id}`)
  }
  if (JSON.stringify(dataset.primaryKey ?? []) !== JSON.stringify(primaryKey)) {
    throw new Error(`the history dataset ${dataset.id} must have the primary key ${primaryKey.join(', ')} (found: ${(dataset.primaryKey ?? []).join(', ') || 'none'})`)
  }
  await log.info(`history dataset ok, ${dataset.title} (${dataset.id})`)
  // the history is written by other organisms too: do not fail if it is being re-indexed
  return waitForIndexed(axios, ref.id, log, { throwOnTimeout: false })
}

const batchSize = 100

/** Current lines of the organism plus the lines closed today, optionally restricted to some sirets. */
export const readHistoryState = async (axios: AxiosInstance, datasetId: string, organisme: string, today: string, log: LogFunctions, isStopped: () => boolean, sirets?: string[]): Promise<PreviousState> => {
  const state: PreviousState = new Map()
  const url = `api/v1/datasets/${datasetId}/lines`
  const base = { organisme_eq: organisme, size: 10000, select: historyKeys.join(',') }
  const batches = sirets ? Array.from({ length: Math.ceil(sirets.length / batchSize) }, (_, i) => sirets.slice(i * batchSize, (i + 1) * batchSize)) : [undefined]

  for (const batch of batches) {
    const params = batch ? { ...base, siret_in: batch.join(',') } : base
    const current = await readAllLines<HistoryLine>(axios, url, { ...params, traitement_termine_eq: 'false' }, log, 'Reading current history lines', isStopped)
    for (const line of current) {
      const key = lineKey(line)
      const entry = state.get(key) ?? {}
      if (entry.current) throw new Error(`two current lines in the history for ${key} (${entry.current.date_debut} and ${line.date_debut})`)
      state.set(key, { ...entry, current: line })
    }
    const closed = await readAllLines<HistoryLine>(axios, url, { ...params, traitement_termine_eq: 'true', date_fin_eq: dayBefore(today) }, log, 'Reading history lines closed today', isStopped)
    for (const line of closed) {
      const key = lineKey(line)
      const entry = state.get(key) ?? {}
      // keep the most recent one if several lines of the same key were closed today
      if (!entry.closedToday || entry.closedToday.date_debut < line.date_debut) state.set(key, { ...entry, closedToday: line })
    }
    if (isStopped()) break
  }
  return state
}

export const countCurrentLines = async (axios: AxiosInstance, datasetId: string, organisme: string): Promise<number> => {
  const { data } = await axios.get<{ total: number }>(`api/v1/datasets/${datasetId}/lines`, { params: { organisme_eq: organisme, traitement_termine_eq: 'false', size: 0 } })
  return data.total
}
