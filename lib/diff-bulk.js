const checkFields = [
  'siret',
  'nom_entreprise',
  'adresse',
  'code_postal',
  'commune',
  'latitude',
  'longitude',
  'telephone',
  'email',
  'site_internet',
  'url_qualification',
  'nom_certificat',
  'particulier'
]

const moment = require('moment')

module.exports = async (previousState, state, processingConfig) => {
  const bulk = []
  const stats = { closed: 0, created: 0, unmodified: 0, updated: 0 }
  const day = moment().format('YYYY-MM-DD')
  const dayMinus1 = moment().add(-1, 'days').format('YYYY-MM-DD')
  for (const key in previousState) {
    if (!state[key]) {
      // disappeared in current state, close record and do not open a new one
      bulk.push({
        _action: 'patch',
        date_debut: previousState[key].date_debut,
        code_qualification: previousState[key].code_qualification,
        siret: previousState[key].siret,
        traitement_termine: true,
        date_fin: dayMinus1
      })
      stats.closed += 1
    }
  }
  for (const key in state) {
    if (!previousState[key]) {
      // appeared in current state, create new record
      bulk.push({
        _action: 'create',
        ...state[key],
        date_debut: day,
        traitement_termine: false
      })
      stats.created += 1
      continue
    }

    const changes = checkFields.filter(f => previousState[key][f] !== state[key][f])
    if (changes.length) {
      // changes on a key that means we have to close / open a new record
      bulk.push({
        _action: 'patch',
        date_debut: previousState[key].date_debut,
        code_qualification: state[key].code_qualification,
        siret: state[key].siret,
        traitement_termine: true,
        date_fin: dayMinus1
      })
      stats.closed += 1

      bulk.push({
        _action: 'create',
        ...state[key],
        traitement_termine: false,
        date_debut: day,
        motif_insertion: changes.join(';')
      })
      stats.created += 1
    } else {
      if (state[key].lien_date_debut !== previousState[key].lien_date_debut || state[key].lien_date_fin !== previousState[key].lien_date_fin) {
        // no significant change except for date_fin, patch it only
        bulk.push({
          _action: 'patch',
          date_debut: previousState[key].date_debut,
          code_qualification: state[key].code_qualification,
          siret: state[key].siret,
          date_fin: state[key].date_fin,
          lien_date_debut: state[key].lien_date_debut,
          lien_date_fin: state[key].lien_date_fin
        })
        stats.updated += 1
      } else if (processingConfig.forceLinkDatesUpdate) {
        bulk.push({
          _action: 'patch',
          date_debut: previousState[key].date_debut,
          code_qualification: state[key].code_qualification,
          siret: state[key].siret,
          lien_date_debut: state[key].lien_date_debut,
          lien_date_fin: state[key].lien_date_fin,
          code_postal: state[key].code_postal
        })
        stats.updated += 1
      } else {
        stats.unmodified += 1
      }
    }
  }
  return { stats, bulk }
}
