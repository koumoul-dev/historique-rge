export default async function (processingConfig, organism, axios, log) {
  await log.task('Suppression des données de l\'historique pour ' + organism)
  let searchParams = new URLSearchParams() // new URL(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/lines`)
  searchParams.set('organisme_eq', organism)
  searchParams.set('select', '_id')
  searchParams.set('size', 10000)
  let url = `api/v1/datasets/${processingConfig.currentHistoryDataset.id}/lines?${searchParams.toString()}`
  let count = 0
  let total
  while (url) {
    const { data } = await axios.get(url)
    total = total || data.total
    url = data.next
    const bulk = data.results.map(l => ({ _id: l._id, _action: 'delete' }))
    while (bulk.length) {
      const lines = bulk.splice(0, 1000)
      try {
        await axios.post(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/_bulk_lines`, lines)
      } catch (error) {
        const result = error.data || error
        if (result.nbErrors) {
          await log.error(`${result.nbErrors} échecs sur ${lines.length} lignes à insérer`)
          for (const error of result.errors) {
            await log.error(JSON.stringify(error))
            await log.error(JSON.stringify(lines[error.line]))
          }
        } else if (result.response) {
          log.error(result.response.data)
          log.error(result.response.status)
          log.error(result.response.headers)
        } else {
          await log.error(JSON.stringify(result))
        }
      }
    }
    count += data.results.length
    await log.progress('Suppression des données de l\'historique pour ' + organism, count, total)
  }

  await log.task('Copie des données depuis l\'ancien historique pour ' + organism)

  searchParams = new URLSearchParams()
  searchParams.set('size', 10000)
  searchParams.set('organisme_eq', organism)

  url = `api/v1/datasets/${processingConfig.oldHistoryDataset.id}/lines?${searchParams.toString()}`

  count = 0
  total = undefined
  while (url) {
    const { data } = await axios(url)
    total = total || data.total
    url = data.next
    const bulk = data.results.map(l => (({ _score, _i, _id, _rand, _geopoint, _updatedAt, ...o }) => ({ ...o, _action: 'create' }))(l))
    while (bulk.length) {
      const lines = bulk.splice(0, 1000)
      try {
        await axios.post(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/_bulk_lines`, lines)
      } catch (error) {
        const result = error.data || error
        if (result.nbErrors) {
          await log.error(`${result.nbErrors} échecs sur ${lines.length} lignes à insérer`)
          for (const error of result.errors) {
            await log.error(JSON.stringify(error))
            await log.error(JSON.stringify(lines[error.line]))
          }
        } else if (result.response) {
          log.error(result.response.data)
          log.error(result.response.status)
          log.error(result.response.headers)
        } else {
          await log.error(JSON.stringify(result))
        }
      }
    }
    count += data.results.length
    await log.progress('Copie des données depuis l\'ancien historique pour ' + organism, count, total)
  }
}
