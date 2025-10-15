export default async function (baseUrl, organism, history, axios, log) {
  const urlObj = new URL(baseUrl + '/lines')
  urlObj.searchParams.set('size', 10000)
  urlObj.searchParams.set('organisme_eq', organism)
  if (history) urlObj.searchParams.set('traitement_termine_eq', false)

  /** @type {string | undefined} */
  let url = urlObj.href

  await log.task('Téléchargement des données')
  let count = 0
  const state = {}
  while (url) {
    const { data } = await axios(url)
    url = data.next
    for (const line of data.results) {
      delete line._score
      state[line.siret + '-' + line.code_qualification] = line
    }
    count += data.results.length
    await log.progress('Téléchargement des données', count, '/', data.total)
  }
}
