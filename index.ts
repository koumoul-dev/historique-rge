// main execution method
import dailyStateFromUrl from './lib/daily-state.js'
import syncWithOld from './lib/sync-with-old.js'
import diffBulk from './lib/diff-bulk.js'

export const run = async ({ processingConfig, axios, log }) => {
  for (const organism of processingConfig.organisms) {
    log.step(`Traitement du répertoire ${organism}`)
    if (processingConfig.syncWithOld) await syncWithOld(processingConfig, organism, axios, log)

    if (processingConfig.updateFromDaily) {
      const previousState = await dailyStateFromUrl(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}`, organism, true, axios, log)
      const currentState = await dailyStateFromUrl(`api/v1/datasets/${processingConfig.dailyDataset.id}`, organism, false, axios, log)
      const { stats, bulk } = await diffBulk(previousState, currentState, processingConfig)
      await log.info(`enregistrement des modifications : ouvertures=${stats.created}, fermetures=${stats.closed}, modifications=${stats.updated}, inchangés=${stats.unmodified}`)
      while (bulk.length) {
        const lines = bulk.splice(0, 1000)
        const result = (await axios.post(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/_bulk_lines`, lines)).data
        if (result.nbErrors) {
          await log.error(`${result.nbErrors} échecs sur ${lines.length} lignes à insérer`)
          for (const error of result.errors) {
            await log.error(JSON.stringify(error))
            await log.error(JSON.stringify(lines[error.line]))
          }
        }
      }
    }
  }
}
