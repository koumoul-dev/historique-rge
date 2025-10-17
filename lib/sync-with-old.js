export default async function (processingConfig, organism, axios, log) {
  await log.task('Suppression des données de l\'historique')
  let searchParams = new URLSearchParams() // new URL(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/lines`)
  searchParams.set('organisme_eq', organism)
  searchParams.set('select', '_id')
  searchParams.set('size', 10000)
  let url = `api/v1/datasets/${processingConfig.currentHistoryDataset.id}/lines?${searchParams.toString()}`
  let count = 0
  while (url) {
    const { data } = await axios.get(url)
    url = data.next
    const bulk = data.results.map(l => ({ _id: l._id, _action: 'delete' }))
    while (bulk.length) {
      const lines = bulk.splice(0, 1000)
      const res = await axios.post(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/_bulk_lines`, lines)
      if (res.data.nbErrors) log.error(`${res.data.nbErrors} échecs sur ${lines.length} lignes à insérer`, res.data.errors)
    }
    count += data.results.length
    await log.progress('Suppression des données de l\'historique', count, '/', data.total)
  }

  await log.task('Copie des données depuis l\'ancien historique')

  searchParams = new URLSearchParams()
  searchParams.set('size', 10000)
  searchParams.set('organisme_eq', organism)

  url = `api/v1/datasets/${processingConfig.oldHistoryDataset.id}/lines?${searchParams.toString()}`

  count = 0
  while (url) {
    const { data } = await axios(url)
    url = data.next
    const bulk = data.results.map(l => (({ _score, _i, _id, _rand, _geopoint, _updatedAt, ...o }) => ({ ...o, _action: 'create' }))(l))
    while (bulk.length) {
      const lines = bulk.splice(0, 1000)
      const res = await axios.post(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/_bulk_lines`, lines)
      if (res.data.nbErrors) log.error(`${res.data.nbErrors} échecs sur ${lines.length} lignes à insérer`, res.data.errors)
    }
    count += data.results.length
    await log.progress('Copie des données depuis l\'ancien historique', count, '/', data.total)
  }
}
