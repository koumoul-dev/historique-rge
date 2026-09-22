import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readDeletedSince } from '../lib/revisions.ts'
import { fakeAxios, noopLog } from './utils.ts'

const rev = (i: number, updatedAt: string, siret: string, deleted = false) => ({ _id: `id-${siret}`, _i: i, _updatedAt: updatedAt, siret, code_qualification: 'c', _deleted: deleted, _action: deleted ? 'delete' : 'createOrUpdate' })

describe('revisions', () => {
  it('collects deleted keys newer than since and reports the window as covered', async () => {
    const axios = fakeAxios({
      'GET /api/v1/datasets/s/revisions': (q) => q.get('before')
        ? { total: 4, results: [rev(1, '2026-09-21T08:00:00.000Z', 'old')] }
        : { total: 4, results: [rev(4, '2026-09-21T11:00:00.000Z', 'a', true), rev(3, '2026-09-21T10:30:00.000Z', 'b', true), rev(2, '2026-09-21T10:00:00.000Z', 'b')], next: 'http://df/api/v1/datasets/s/revisions?size=3&before=2' }
    })
    const res = await readDeletedSince(axios, 's', '2026-09-21T09:00:00.000Z', noopLog, () => false)
    assert.deepEqual([...res.deletedKeys], ['a|c', 'b|c'])
    assert.equal(res.covered, true)
  })

  it('ignores a deletion followed by a re-creation of the same line', async () => {
    const axios = fakeAxios({
      'GET /api/v1/datasets/s/revisions': () => ({ total: 3, results: [rev(3, '2026-09-21T11:00:00.000Z', 'a'), rev(2, '2026-09-21T10:00:00.000Z', 'a', true), rev(1, '2026-09-21T08:00:00.000Z', 'x')] })
    })
    const res = await readDeletedSince(axios, 's', '2026-09-21T09:00:00.000Z', noopLog, () => false)
    assert.equal(res.deletedKeys.size, 0)
    assert.equal(res.covered, true)
  })

  it('reports an uncovered window when the revisions end before reaching since', async () => {
    const axios = fakeAxios({
      'GET /api/v1/datasets/s/revisions': () => ({ total: 1, results: [rev(1, '2026-09-21T11:00:00.000Z', 'a', true)] })
    })
    const res = await readDeletedSince(axios, 's', '2026-09-21T09:00:00.000Z', noopLog, () => false)
    assert.equal(res.covered, false)
  })

  it('rejects a deleted revision without the primary key fields', async () => {
    const axios = fakeAxios({
      'GET /api/v1/datasets/s/revisions': () => ({ total: 1, results: [{ _id: 'id-a', _i: 1, _updatedAt: '2026-09-21T11:00:00.000Z', _deleted: true, code_qualification: 'c' }] })
    })
    await assert.rejects(readDeletedSince(axios, 's', '2026-09-21T09:00:00.000Z', noopLog, () => false), /deleted revision without siret\/code_qualification in s/)
  })

  it('treats an empty revisions collection as uncovered', async () => {
    const axios = fakeAxios({ 'GET /api/v1/datasets/s/revisions': () => ({ total: 0, results: [] }) })
    const res = await readDeletedSince(axios, 's', '2026-09-21T09:00:00.000Z', noopLog, () => false)
    assert.equal(res.covered, false)
  })
})
