import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import type { BulkOp } from './types.ts'

export type Page<T> = { total: number, results: T[], next?: string }

export type DatasetInfo = {
  id: string
  title: string
  slug?: string
  isRest?: boolean
  schema: { key: string }[]
  primaryKey?: string[]
  rest?: { history?: boolean }
  dataUpdatedAt?: string
  finalizedAt?: string
}

type BulkSummary = { nbOk: number, nbNotModified: number, nbErrors: number, errors: { line: number, error: string, status: number }[] }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function * iteratePages<T> (axios: AxiosInstance, url: string, params: Record<string, string | number>): AsyncGenerator<Page<T>> {
  let res = await axios.get<Page<T>>(url, { params })
  yield res.data
  while (res.data.next) {
    res = await axios.get<Page<T>>(res.data.next)
    yield res.data
  }
}

export const readAllLines = async <T>(axios: AxiosInstance, url: string, params: Record<string, string | number>, log: LogFunctions, taskName: string, isStopped: () => boolean): Promise<T[]> => {
  const lines: T[] = []
  await log.task(taskName)
  for await (const page of iteratePages<T>(axios, url, params)) {
    lines.push(...page.results)
    await log.progress(taskName, lines.length, page.total)
    if (isStopped()) break
  }
  return lines
}

export const getDataset = async (axios: AxiosInstance, id: string): Promise<DatasetInfo> => (await axios.get<DatasetInfo>(`api/v1/datasets/${id}`)).data

/** Polls the dataset until every write is indexed (finalizedAt caught up with dataUpdatedAt). */
export const waitForIndexed = async (axios: AxiosInstance, id: string, log: LogFunctions, options: { timeoutMs?: number, intervalMs?: number, throwOnTimeout?: boolean } = {}): Promise<DatasetInfo> => {
  const { timeoutMs = 10 * 60 * 1000, intervalMs = 5000, throwOnTimeout = true } = options
  const start = Date.now()
  while (true) {
    const dataset = await getDataset(axios, id)
    if (!dataset.dataUpdatedAt || (dataset.finalizedAt && dataset.finalizedAt >= dataset.dataUpdatedAt)) return dataset
    if (Date.now() - start >= timeoutMs) {
      const message = `dataset ${dataset.title} (${id}) is not indexed yet (dataUpdatedAt=${dataset.dataUpdatedAt}, finalizedAt=${dataset.finalizedAt})`
      if (throwOnTimeout) throw new Error(message)
      await log.warning(message)
      return dataset
    }
    await log.debug(`waiting for dataset ${id} to be indexed`)
    await sleep(intervalMs)
  }
}

const chunkSize = 1000

/** The bulk_lines summary carried by an axios error, or by a bare response (lib-processing-dev rejects with it directly). */
const bulkErrorSummary = (err: unknown): BulkSummary | undefined => {
  const e = err as { response?: { data?: unknown }, data?: unknown } | undefined
  const data = e?.response?.data ?? e?.data
  return (!!data && Array.isArray((data as BulkSummary).errors)) ? data as BulkSummary : undefined
}

/** Sends the operations by chunks. A 404 on patch/delete is a line already handled by a previous run: warn and go on. */
export const bulkLines = async (axios: AxiosInstance, id: string, ops: BulkOp[], log: LogFunctions, isStopped: () => boolean) => {
  const result = { nbOk: 0, nbNotModified: 0, nbMissing: 0 }
  let nbRejected = 0
  const taskName = `Writing ${ops.length} operations`
  await log.task(taskName)
  for (let i = 0; i < ops.length; i += chunkSize) {
    if (isStopped()) break
    const chunk = ops.slice(i, i + chunkSize)
    let summary: BulkSummary
    try {
      summary = (await axios.post<BulkSummary>(`api/v1/datasets/${id}/_bulk_lines`, chunk)).data
    } catch (err: unknown) {
      // data-fair answers 400 with the same summary when every line was rejected
      const rejected = bulkErrorSummary(err)
      if (!rejected) throw err
      summary = rejected
    }
    result.nbOk += summary.nbOk
    result.nbNotModified += summary.nbNotModified
    for (const error of summary.errors) {
      const op = chunk[error.line]
      if (error.status === 404 && op && op._action !== 'createOrUpdate') {
        result.nbMissing++
        await log.warning(`line already ${op._action === 'delete' ? 'deleted' : 'closed'} by a previous run: ${JSON.stringify(op)}`)
      } else {
        nbRejected++
        await log.error(`rejected operation: ${error.error}`, op)
      }
    }
    // the errors list is capped at 50 by data-fair, count the rest as rejected
    nbRejected += Math.max(0, summary.nbErrors - summary.errors.length)
    await log.progress(taskName, Math.min(i + chunkSize, ops.length), ops.length)
  }
  if (nbRejected) throw new Error(`${nbRejected} line(s) rejected by the history dataset, see the errors above`)
  return result
}
