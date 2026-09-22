import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { checkHistoryDataset, readHistoryState, countCurrentLines, historyKeys } from '../lib/history.ts'
import { fakeAxios, noopLog } from './utils.ts'
import schema from '../resources/schema.json' with { type: 'json' }

const pk = ['organisme', 'siret', 'code_qualification', 'date_debut']
const dataset = (over: Record<string, unknown> = {}) => ({ id: 'h', title: 'History', isRest: true, schema, primaryKey: pk, dataUpdatedAt: '2026-09-21T10:00:00.000Z', finalizedAt: '2026-09-21T10:00:00.000Z', ...over })

describe('history', () => {
  it('lists the 24 keys of the history schema', () => {
    assert.equal(historyKeys.length, 24)
    assert.ok(historyKeys.includes('traitement_termine'))
  })

  it('accepts a matching history dataset', async () => {
    const axios = fakeAxios({ 'GET /api/v1/datasets/h': () => dataset() })
    const info = await checkHistoryDataset(axios, { id: 'h', title: 'History' }, noopLog)
    assert.equal(info.id, 'h')
  })

  it('rejects a missing column, a wrong primary key and a non-REST dataset', async () => {
    await assert.rejects(checkHistoryDataset(fakeAxios({ 'GET /api/v1/datasets/h': () => dataset({ schema: schema.filter(p => p.key !== 'motif_insertion') }) }), { id: 'h', title: 'H' }, noopLog), /missing column/)
    await assert.rejects(checkHistoryDataset(fakeAxios({ 'GET /api/v1/datasets/h': () => dataset({ primaryKey: ['siret'] }) }), { id: 'h', title: 'H' }, noopLog), /primary key/)
    await assert.rejects(checkHistoryDataset(fakeAxios({ 'GET /api/v1/datasets/h': () => dataset({ isRest: false }) }), { id: 'h', title: 'H' }, noopLog), /editable/)
  })

  it('loads current lines and lines closed today, keyed by siret and code', async () => {
    const calls: string[] = []
    const line = (siret: string, over: Record<string, unknown> = {}) => ({ siret, code_qualification: 'c', organisme: 'o', date_debut: '2025-01-01', traitement_termine: false, ...over })
    const axios = fakeAxios({
      'GET /api/v1/datasets/h/lines': (q) => {
        if (q.get('traitement_termine_eq') === 'false') return { total: 2, results: [line('1'), line('2')] }
        assert.equal(q.get('date_fin_eq'), '2026-09-20')
        return { total: 1, results: [line('1', { date_debut: '2024-01-01', date_fin: '2026-09-20', traitement_termine: true })] }
      }
    }, calls)
    const state = await readHistoryState(axios, 'h', 'o', '2026-09-21', noopLog, () => false)
    assert.equal(state.size, 2)
    assert.equal(state.get('1|c')?.current?.date_debut, '2025-01-01')
    assert.equal(state.get('1|c')?.closedToday?.date_debut, '2024-01-01')
    assert.equal(state.get('2|c')?.closedToday, undefined)
    assert.ok(calls.every(c => c.includes('organisme_eq=o')))
  })

  it('restricts the reads to batches of sirets when given', async () => {
    const calls: string[] = []
    const axios = fakeAxios({ 'GET /api/v1/datasets/h/lines': () => ({ total: 0, results: [] }) }, calls)
    const sirets = Array.from({ length: 150 }, (_, i) => String(i))
    await readHistoryState(axios, 'h', 'o', '2026-09-21', noopLog, () => false, sirets)
    // 2 batches (100 + 50) × 2 queries (current + closed today)
    assert.equal(calls.length, 4)
    assert.ok(calls[0].includes('siret_in='))
  })

  it('throws when two current lines share a key', async () => {
    const line = { siret: '1', code_qualification: 'c', organisme: 'o', traitement_termine: false }
    const axios = fakeAxios({
      'GET /api/v1/datasets/h/lines': (q) => q.get('traitement_termine_eq') === 'false'
        ? { total: 2, results: [{ ...line, date_debut: '2025-01-01' }, { ...line, date_debut: '2025-02-01' }] }
        : { total: 0, results: [] }
    })
    await assert.rejects(readHistoryState(axios, 'h', 'o', '2026-09-21', noopLog, () => false), /two current lines/)
  })

  it('counts the current lines of the organism', async () => {
    const axios = fakeAxios({ 'GET /api/v1/datasets/h/lines': (q) => { assert.equal(q.get('size'), '0'); return { total: 42, results: [] } } })
    assert.equal(await countCurrentLines(axios, 'h', 'o'), 42)
  })
})
