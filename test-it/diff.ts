import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { diff } from '../lib/diff.ts'
import type { HistoryLine, SourceLine, PreviousState, CurrentState, BulkOp } from '../lib/types.ts'

const J = '2026-09-21'
const org = 'qualibat'

const src = (over: Partial<SourceLine> = {}): SourceLine => ({
  siret: '12345678900011',
  code_qualification: '8611',
  nom_entreprise: 'ACME',
  adresse: '1 rue A',
  code_postal: '75001',
  commune: 'PARIS',
  latitude: 48.8,
  longitude: 2.3,
  telephone: '01 02 03 04 05',
  email: 'a@acme.fr',
  site_internet: '',
  nom_qualification: 'Isolation',
  url_qualification: 'https://q/1',
  nom_certificat: 'cert',
  domaine: 'D',
  meta_domaine: 'MD',
  particulier: true,
  lien_date_debut: '2025-01-01',
  lien_date_fin: '2027-01-01',
  ...over
})

const hist = (over: Partial<HistoryLine> = {}): HistoryLine => ({
  ...src(),
  organisme: org,
  date_debut: '2025-01-01',
  date_fin: '2027-01-01',
  traitement_termine: false,
  ...over
})

const key = '12345678900011|8611'
const prev = (entry: PreviousState extends Map<string, infer V> ? V : never): PreviousState => new Map([[key, entry]])
const cur = (line?: SourceLine): CurrentState => new Map(line ? [[key, line]] : [])
const ref = (dateDebut: string) => ({ siret: '12345678900011', code_qualification: '8611', date_debut: dateDebut })

describe('diff', () => {
  it('creates a line for a new key', () => {
    const { ops, stats } = diff(new Map(), cur(src()), org, J)
    assert.equal(stats.created, 1)
    assert.equal(ops.length, 1)
    const op = ops[0] as Extract<BulkOp, { _action: 'createOrUpdate' }>
    assert.equal(op._action, 'createOrUpdate')
    assert.equal(op.date_debut, J)
    assert.equal(op.date_fin, '2027-01-01')
    assert.equal(op.traitement_termine, false)
    assert.equal(op.organisme, org)
    assert.equal(op.motif_insertion, undefined)
  })

  it('closes and reopens when a compared field changes on an older line', () => {
    const { ops, stats } = diff(prev({ current: hist() }), cur(src({ adresse: '2 rue B', telephone: '' })), org, J)
    assert.deepEqual(stats, { created: 1, closed: 1, updated: 0, reopened: 0, deleted: 0, unchanged: 0 })
    assert.deepEqual(ops[0], { _action: 'patch', ...ref('2025-01-01'), traitement_termine: true, date_fin: '2026-09-20' })
    const created = ops[1] as Extract<BulkOp, { _action: 'createOrUpdate' }>
    assert.equal(created.date_debut, J)
    assert.equal(created.motif_insertion, 'adresse;telephone')
    assert.equal(created.adresse, '2 rue B')
    assert.equal('telephone' in created, false, 'empty values are not written on creation')
  })

  it('patches the line in place when it was opened today', () => {
    const { ops, stats } = diff(
      prev({ current: hist({ date_debut: J }), closedToday: hist({ date_debut: '2024-01-01', date_fin: '2026-09-20', traitement_termine: true, adresse: 'old' }) }),
      cur(src({ adresse: 'newer', email: '' })), org, J)
    assert.deepEqual(stats, { created: 0, closed: 0, updated: 1, reopened: 0, deleted: 0, unchanged: 0 })
    const op = ops[0] as Record<string, unknown>
    assert.equal(op._action, 'patch')
    assert.equal(op.date_debut, J)
    assert.equal(op.adresse, 'newer')
    assert.equal(op.email, null, 'an emptied field is removed with null')
    assert.equal(op.motif_insertion, 'adresse;email', 'motive is recomputed against the line closed today')
  })

  it('patches only link and descriptive fields when nothing else changed', () => {
    const { ops, stats } = diff(prev({ current: hist() }), cur(src({ lien_date_fin: '2028-01-01', domaine: 'D2' })), org, J)
    assert.deepEqual(stats, { created: 0, closed: 0, updated: 1, reopened: 0, deleted: 0, unchanged: 0 })
    assert.deepEqual(ops[0], {
      _action: 'patch',
      ...ref('2025-01-01'),
      lien_date_debut: '2025-01-01',
      lien_date_fin: '2028-01-01',
      date_fin: '2028-01-01',
      nom_qualification: 'Isolation',
      domaine: 'D2',
      meta_domaine: 'MD'
    })
  })

  it('patches link and descriptive fields to null when emptied or missing', () => {
    const { ops, stats } = diff(prev({ current: hist() }), cur(src({ lien_date_fin: '', domaine: undefined })), org, J)
    assert.deepEqual(stats, { created: 0, closed: 0, updated: 1, reopened: 0, deleted: 0, unchanged: 0 })
    assert.deepEqual(ops[0], {
      _action: 'patch',
      ...ref('2025-01-01'),
      lien_date_debut: '2025-01-01',
      lien_date_fin: null,
      date_fin: null,
      nom_qualification: 'Isolation',
      domaine: null,
      meta_domaine: 'MD'
    })
  })

  it('creates a line without a date_fin or lien_date_fin when the link has no end date', () => {
    const { ops } = diff(new Map(), cur(src({ lien_date_fin: '' })), org, J)
    assert.deepEqual(ops[0], {
      _action: 'createOrUpdate',
      siret: '12345678900011',
      code_qualification: '8611',
      nom_entreprise: 'ACME',
      adresse: '1 rue A',
      code_postal: '75001',
      commune: 'PARIS',
      latitude: 48.8,
      longitude: 2.3,
      telephone: '01 02 03 04 05',
      email: 'a@acme.fr',
      nom_qualification: 'Isolation',
      url_qualification: 'https://q/1',
      nom_certificat: 'cert',
      domaine: 'D',
      meta_domaine: 'MD',
      particulier: true,
      lien_date_debut: '2025-01-01',
      organisme: org,
      date_debut: J,
      traitement_termine: false
    })
  })

  it('does nothing when nothing changed, treating empty and missing values alike', () => {
    const { ops, stats } = diff(prev({ current: hist({ site_internet: undefined }) }), cur(src({ site_internet: '', latitude: '48.8' as unknown as number })), org, J)
    assert.equal(ops.length, 0)
    assert.equal(stats.unchanged, 1)
  })

  it('treats particulier false as absent and compares coordinates by value, like the legacy flow', () => {
    const { ops, stats } = diff(prev({ current: hist({ particulier: false, latitude: 48.8 }) }), cur(src({ particulier: undefined, latitude: '48.80' })), org, J)
    assert.equal(ops.length, 0)
    assert.equal(stats.unchanged, 1)
  })

  it('never compares siret or code_postal numerically, leading zeros matter', () => {
    const { stats } = diff(prev({ current: hist({ siret: '01234' }) }), cur(src({ siret: '1234' })), org, J)
    assert.deepEqual(stats, { created: 1, closed: 1, updated: 0, reopened: 0, deleted: 0, unchanged: 0 })
    const postal = diff(prev({ current: hist({ code_postal: '01000' }) }), cur(src({ code_postal: '1000' })), org, J)
    assert.equal(postal.stats.closed, 1)
  })

  it('omits particulier false on creation and removes it with null in a patch', () => {
    const created = diff(new Map(), cur(src({ particulier: false })), org, J).ops[0] as Record<string, unknown>
    assert.equal('particulier' in created, false)
    const { ops } = diff(prev({ current: hist({ date_debut: J, particulier: true }) }), cur(src({ particulier: false })), org, J)
    assert.equal((ops[0] as Record<string, unknown>).particulier, null)
  })

  it('closes an older line that disappeared', () => {
    const { ops, stats } = diff(prev({ current: hist() }), cur(), org, J)
    assert.equal(stats.closed, 1)
    assert.deepEqual(ops[0], { _action: 'patch', ...ref('2025-01-01'), traitement_termine: true, date_fin: '2026-09-20' })
  })

  it('deletes a line opened today that disappeared', () => {
    const { ops, stats } = diff(prev({ current: hist({ date_debut: J }) }), cur(), org, J)
    assert.equal(stats.deleted, 1)
    assert.deepEqual(ops[0], { _action: 'delete', ...ref(J) })
  })

  it('reopens a line closed today when the data is back to identical', () => {
    const closed = hist({ date_fin: '2026-09-20', traitement_termine: true })
    const { ops, stats } = diff(prev({ closedToday: closed }), cur(src({ lien_date_fin: '2027-06-01' })), org, J)
    assert.equal(stats.reopened, 1)
    assert.deepEqual(ops[0], {
      _action: 'patch',
      ...ref('2025-01-01'),
      traitement_termine: false,
      date_fin: '2027-06-01',
      lien_date_debut: '2025-01-01',
      lien_date_fin: '2027-06-01',
      nom_qualification: 'Isolation',
      domaine: 'D',
      meta_domaine: 'MD'
    })
  })

  it('creates a new line when a line closed today comes back different', () => {
    const closed = hist({ date_fin: '2026-09-20', traitement_termine: true })
    const { ops, stats } = diff(prev({ closedToday: closed }), cur(src({ commune: 'LYON' })), org, J)
    assert.deepEqual(stats, { created: 1, closed: 0, updated: 0, reopened: 0, deleted: 0, unchanged: 0 })
    const created = ops[0] as Extract<BulkOp, { _action: 'createOrUpdate' }>
    assert.equal(created.motif_insertion, 'commune')
  })

  it('undoes a same-day change when the data goes back to the line closed today', () => {
    const closed = hist({ date_fin: '2026-09-20', traitement_termine: true })
    const opened = hist({ date_debut: J, commune: 'LYON', motif_insertion: 'commune' })
    const { ops, stats } = diff(prev({ current: opened, closedToday: closed }), cur(src()), org, J)
    assert.deepEqual(stats, { created: 0, closed: 0, updated: 0, reopened: 1, deleted: 1, unchanged: 0 })
    assert.deepEqual(ops[0], { _action: 'delete', ...ref(J) })
    assert.equal(ops[1]._action, 'patch')
    assert.equal((ops[1] as Record<string, unknown>).traitement_termine, false)
  })

  it('leaves a line closed today alone when it is still absent', () => {
    const closed = hist({ date_fin: '2026-09-20', traitement_termine: true })
    const { ops } = diff(prev({ closedToday: closed }), cur(), org, J)
    assert.equal(ops.length, 0)
  })

  it('only looks at the given keys in incremental mode', () => {
    const previous: PreviousState = new Map([
      [key, { current: hist() }],
      ['other|1', { current: hist({ siret: 'other', code_qualification: '1' }) }]
    ])
    const { ops, stats } = diff(previous, cur(), org, J, [key])
    assert.equal(ops.length, 1)
    assert.equal(stats.closed, 1)
  })
})
