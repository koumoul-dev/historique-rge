// main execution method
import dailyStateFromUrl from './lib/daily-state.js'
import syncWithOld from './lib/sync-with-old.js'
import diffBulk from './lib/diff-bulk.js'
import fs from 'fs-extra'
import path from 'path'
import datasetSchema from './resources/schema.json' with { type: 'json' }

console.log(datasetSchema)

export const run = async ({ processingConfig, processingId, dir, axios, log, patchConfig }) => {
  let dataset
  if (processingConfig.datasetMode === 'create') {
    await log.step('Création du jeu de données')
    dataset = (await axios.post('api/v1/datasets', {
      id: processingConfig.dataset.id,
      title: processingConfig.dataset.title,
      isRest: true,
      schema: datasetSchema,
      primaryKey: ['siret', 'code_qualification', 'date_debut'],
      extras: { processingId }
    })).data
    await log.info(`jeu de donnée créé, id="${dataset.id}", title="${dataset.title}"`)
    await patchConfig({ datasetMode: 'update', dataset: { id: dataset.id, title: dataset.title } })
  } else if (processingConfig.datasetMode === 'update') {
    await log.step('Vérification du jeu de données')
    dataset = (await axios.get(`api/v1/datasets/${processingConfig.dataset.id}`)).data
    if (!dataset) throw new Error(`le jeu de données n'existe pas, id${processingConfig.dataset.id}`)
    await log.info(`le jeu de donnée existe, id="${dataset.id}", title="${dataset.title}"`)
  }

  for (const organism of processingConfig.organisms) {
    log.step(`Traitement du répertoire ${organism}`)
    await fs.ensureDir(path.join(dir, organism))
    if (processingConfig.syncWithOld) await syncWithOld(processingConfig, organism, axios, log)

    if (processingConfig.updateFromDaily) {
      const previousState = await dailyStateFromUrl(processingConfig.currentHistoryDataset, organism, true, axios, log)
      const currentState = await dailyStateFromUrl(processingConfig.dailyDataset, organism, false, axios, log)
      const { stats, bulk } = await diffBulk(previousState, currentState, processingConfig)
      await log.info(`enregistrement des modifications : ouvertures=${stats.created}, fermetures=${stats.closed}, modifications=${stats.updated}, inchangés=${stats.unmodified}`)
      while (bulk.length) {
        const lines = bulk.splice(0, 1000)
        const res = await axios.post(`api/v1/datasets/${dataset.id}/_bulk_lines`, lines)
        if (res.data.nbErrors) log.error(`${res.data.nbErrors} échecs sur ${lines.length} lignes à insérer`, res.data.errors)
      }
    }
  }
}
