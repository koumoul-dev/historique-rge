export default async function (processingConfig, organism, axios, log) {
  await log.task('Suppression des données de l\'historique pour', organism)
  let urlObj = new URL(processingConfig.currentHistoryDataset + '/lines')
  urlObj.searchParams.set('organisme_eq', organism)
  urlObj.searchParams.set('select', '_id')
  urlObj.searchParams.set('size', 10000)
  let url = urlObj.href
  let count = 0
  while (url) {
    const { data } = await axios(url)
    url = data.next
    const bulk = data.results.map(l => ({ _id: l._id, _action: 'delete' }))
    while (bulk.length) {
      const lines = bulk.splice(0, 1000)
      const res = await axios.post(processingConfig.currentHistoryDataset + '/_bulk_lines', lines)
      if (res.data.nbErrors) log.error(`${res.data.nbErrors} échecs sur ${lines.length} lignes à insérer`, res.data.errors)
    }
    count += data.results.length
    await log.progress('Suppression des données', count, '/', data.total)
  }

  await log.task('Copie des données depuis l\'ancien historique pour', organism)

  urlObj = new URL(processingConfig.oldHistoryDataset + '/lines')
  urlObj.searchParams.set('size', 10000)
  urlObj.searchParams.set('organisme_eq', organism)

  url = urlObj.href

  count = 0
  while (url) {
    const { data } = await axios(url)
    url = data.next
    const bulk = data.results.map(l => (({ _score, _i, _id, _rand, _geopoint, _updatedAt, ...o }) => ({ ...o, _action: 'create' }))(l))
    while (bulk.length) {
      const lines = bulk.splice(0, 1000)
      const res = await axios.post(processingConfig.currentHistoryDataset + '/_bulk_lines', lines)
      if (res.data.nbErrors) log.error(`${res.data.nbErrors} échecs sur ${lines.length} lignes à insérer`, res.data.errors)
    }
    count += data.results.length
    await log.progress('Copie des données', count, '/', data.total)
  }
}
