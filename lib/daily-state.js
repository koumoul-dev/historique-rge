export default async function (baseUrl, organism, history, axios, log) {
  const searchParams = new URLSearchParams() // new URL(`api/v1/datasets/${processingConfig.currentHistoryDataset.id}/lines`)
  searchParams.set('organisme_eq', organism)
  searchParams.set('size', 10000)
  if (history) searchParams.set('traitement_termine_eq', false)
  let url = `${baseUrl}/lines?${searchParams.toString()}`

  await log.task(`Téléchargement des données ${history ? 'précédentes' : 'actuelles'} pour ${organism}`)
  let count = 0
  let total
  const state = {}
  while (url) {
    const { data } = await axios(url)
    total = total || data.total
    url = data.next
    for (const line of data.results) {
      delete line._score
      delete line._id
      delete line._i
      delete line._rand
      delete line._geopoint
      state[line.siret + '-' + line.code_qualification] = line
    }
    count += data.results.length
    await log.progress(`Téléchargement des données ${history ? 'précédentes' : 'actuelles'} pour ${organism}`, count, total)
  }
  await log.task(Object.keys(state).length + ' enregistrements')
  return state
}
