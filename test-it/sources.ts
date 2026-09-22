import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { getSourceInfo, chooseStrategy, sinceFrom, readSourceFull, readSourceIncremental } from '../lib/sources.ts'
import { sourceKeys } from '../lib/types.ts'
import { fakeAxios, noopLog } from './utils.ts'

const schema = sourceKeys.map(key => ({ key }))
const dataset = (over: Record<string, unknown> = {}) => ({ id: 's', title: 'Source', isRest: true, schema, rest: { history: true }, dataUpdatedAt: '2026-09-21T10:00:00.000Z', finalizedAt: '2026-09-21T10:00:00.000Z', ...over })
const info = (over: Partial<ReturnType<typeof baseInfo>> = {}) => ({ ...baseInfo(), ...over })
const baseInfo = () => ({ id: 's', title: 'Source', isRest: true, hasHistory: true, dataUpdatedAt: '2026-09-21T10:00:00.000Z' })

describe('sources', () => {
  it('reads the source info and checks its columns', async () => {
    const res = await getSourceInfo(fakeAxios({ 'GET /api/v1/datasets/s': () => dataset() }), { id: 's', title: 'Source' }, noopLog)
    assert.deepEqual(res, baseInfo())
    await assert.rejects(getSourceInfo(fakeAxios({ 'GET /api/v1/datasets/s': () => dataset({ schema: schema.filter(p => p.key !== 'lien_date_fin') }) }), { id: 's', title: 'Source' }, noopLog), /missing column "lien_date_fin"/)
    const file = await getSourceInfo(fakeAxios({ 'GET /api/v1/datasets/s': () => dataset({ isRest: undefined, rest: undefined, file: { name: 'x.csv' } }) }), { id: 's', title: 'Source' }, noopLog)
    assert.equal(file.isRest, false)
    assert.equal(file.hasHistory, false)
  })

  it('chooses the strategy from the mode, the source kind and the cursor', () => {
    assert.equal(chooseStrategy('auto', info({ isRest: false, hasHistory: false })), 'full')
    assert.equal(chooseStrategy('auto', info({ hasHistory: false }), '2026-09-21T09:00:00.000Z'), 'full')
    assert.equal(chooseStrategy('auto', info()), 'full')
    assert.equal(chooseStrategy('auto', info(), '2026-09-21T09:00:00.000Z'), 'incremental')
    assert.equal(chooseStrategy('full', info(), '2026-09-21T09:00:00.000Z'), 'full')
    assert.equal(chooseStrategy('incremental', info(), '2026-09-21T09:00:00.000Z'), 'incremental')
    assert.equal(chooseStrategy('incremental', info()), 'full')
    assert.throws(() => chooseStrategy('incremental', info({ isRest: false, hasHistory: false }), '2026-09-21T09:00:00.000Z'), /not an editable dataset/)
    assert.throws(() => chooseStrategy('incremental', info({ hasHistory: false }), '2026-09-21T09:00:00.000Z'), /line history/)
  })

  it('subtracts the overlap from the cursor', () => {
    assert.equal(sinceFrom('2026-09-21T10:00:00.000Z'), '2026-09-21T09:45:00.000Z')
  })

  it('reads every line in full mode with the source columns only', async () => {
    const calls: string[] = []
    const axios = fakeAxios({ 'GET /api/v1/datasets/s/lines': () => ({ total: 1, results: [{ siret: '1', code_qualification: 'c' }] }) }, calls)
    const lines = await readSourceFull(axios, info(), noopLog, () => false)
    assert.equal(lines.length, 1)
    assert.ok(calls[0].includes(`select=${encodeURIComponent(sourceKeys.join(','))}`) || calls[0].includes(`select=${sourceKeys.join('%2C')}`))
    assert.ok(calls[0].includes('size=10000'))
  })

  it('reads modified lines since a date and the deletions in incremental mode', async () => {
    const calls: string[] = []
    const axios = fakeAxios({
      'GET /api/v1/datasets/s/lines': (q) => { assert.equal(q.get('_updatedAt_gte'), '2026-09-21T09:45:00.000Z'); return { total: 1, results: [{ siret: '1', code_qualification: 'c', _updatedAt: '2026-09-21T09:50:00.000Z' }] } },
      'GET /api/v1/datasets/s/revisions': () => ({ total: 2, results: [{ _id: 'x', _updatedAt: '2026-09-21T09:55:00.000Z', _deleted: true, siret: '2', code_qualification: 'c' }, { _id: 'y', _updatedAt: '2026-09-21T09:00:00.000Z', siret: '3', code_qualification: 'c' }] })
    }, calls)
    const res = await readSourceIncremental(axios, info(), '2026-09-21T09:45:00.000Z', noopLog, () => false)
    assert.equal(res.modified.length, 1)
    assert.deepEqual([...res.deletedKeys], ['2|c'])
    assert.equal(res.covered, true)
  })
})
