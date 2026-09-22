import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import { iteratePages } from './data-fair.ts'
import { lineKey } from './types.ts'

type Revision = { _id: string, _updatedAt: string, _deleted?: boolean, siret?: string, code_qualification?: string }

/**
 * Walks the revisions newest first and returns the keys whose latest revision since `since` is a deletion.
 * `covered` is false when the walk ends before reaching a revision older than `since`.
 */
export const readDeletedSince = async (axios: AxiosInstance, datasetId: string, since: string, log: LogFunctions, isStopped: () => boolean) => {
  const deletedKeys = new Set<string>()
  const seen = new Set<string>()
  let covered = false
  let count = 0
  const taskName = `Reading revisions of ${datasetId}`
  await log.task(taskName)
  for await (const page of iteratePages<Revision>(axios, `api/v1/datasets/${datasetId}/revisions`, { size: 10000 })) {
    for (const revision of page.results) {
      if (revision._updatedAt < since) {
        covered = true
        break
      }
      count++
      if (seen.has(revision._id)) continue
      seen.add(revision._id)
      if (!revision._deleted) continue
      // data-fair only keeps the primary key fields on a deleted revision
      const { siret, code_qualification: code } = revision
      if (!siret || !code) throw new Error(`deleted revision without siret/code_qualification in ${datasetId}`)
      deletedKeys.add(lineKey({ siret, code_qualification: code }))
    }
    await log.progress(taskName, count, page.total)
    if (covered || isStopped()) break
  }
  return { deletedKeys, covered }
}
