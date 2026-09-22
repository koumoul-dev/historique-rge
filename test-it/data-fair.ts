import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readAllLines, waitForIndexed, bulkLines } from '../lib/data-fair.ts'
import { fakeAxios, noopLog, recordingLog } from './utils.ts'

describe('data-fair helpers', () => {
  it('follows next links and concatenates results', async () => {
    const calls: string[] = []
    const axios = fakeAxios({
      'GET /api/v1/datasets/d/lines': (q) => q.get('after')
        ? { total: 3, results: [{ i: 3 }] }
        : { total: 3, results: [{ i: 1 }, { i: 2 }], next: 'http://df/api/v1/datasets/d/lines?size=2&after=2' }
    }, calls)
    const lines = await readAllLines<{ i: number }>(axios, 'api/v1/datasets/d/lines', { size: 2 }, noopLog, 'read', () => false)
    assert.deepEqual(lines.map(l => l.i), [1, 2, 3])
    assert.equal(calls.length, 2)
  })

  it('stops reading pages when the stop flag is raised', async () => {
    let stopped = false
    const axios = fakeAxios({
      'GET /api/v1/datasets/d/lines': () => { stopped = true; return { total: 4, results: [{ i: 1 }], next: 'http://df/api/v1/datasets/d/lines?after=1' } }
    })
    const lines = await readAllLines(axios, 'api/v1/datasets/d/lines', { size: 1 }, noopLog, 'read', () => stopped)
    assert.equal(lines.length, 1)
  })

  it('waits until the dataset is indexed', async () => {
    let polls = 0
    const axios = fakeAxios({
      'GET /api/v1/datasets/d': () => {
        polls++
        return { id: 'd', title: 'D', schema: [], dataUpdatedAt: '2026-09-21T10:00:00.000Z', finalizedAt: polls < 3 ? '2026-09-21T09:00:00.000Z' : '2026-09-21T10:00:01.000Z' }
      }
    })
    const dataset = await waitForIndexed(axios, 'd', noopLog, { intervalMs: 1 })
    assert.equal(polls, 3)
    assert.equal(dataset.finalizedAt, '2026-09-21T10:00:01.000Z')
  })

  it('throws or warns on indexing timeout depending on the option', async () => {
    const axios = fakeAxios({
      'GET /api/v1/datasets/d': () => ({ id: 'd', title: 'D', schema: [], dataUpdatedAt: '2026-09-21T10:00:00.000Z', finalizedAt: '2026-09-21T09:00:00.000Z' })
    })
    await assert.rejects(waitForIndexed(axios, 'd', noopLog, { intervalMs: 1, timeoutMs: 5 }), /not indexed/)
    const { log, messages } = recordingLog()
    await waitForIndexed(axios, 'd', log, { intervalMs: 1, timeoutMs: 5, throwOnTimeout: false })
    assert.equal(messages.filter(m => m.level === 'warning').length, 1)
  })

  it('uploads by chunks of 1000 and tolerates 404 on patch and delete', async () => {
    const bodies: unknown[][] = []
    const axios = fakeAxios({
      'POST /api/v1/datasets/h/_bulk_lines': (_q, body) => {
        bodies.push(body as unknown[])
        return { nbOk: (body as unknown[]).length - 1, nbNotModified: 0, nbErrors: 1, errors: [{ line: 0, error: 'ligne non trouvée', status: 404 }] }
      }
    })
    const ops = Array.from({ length: 1500 }, (_, i) => ({ _action: 'patch' as const, organisme: 'o', siret: String(i), code_qualification: 'c', date_debut: '2026-01-01', traitement_termine: true }))
    const { log, messages } = recordingLog()
    const summary = await bulkLines(axios, 'h', ops, log, () => false)
    assert.deepEqual(bodies.map(b => b.length), [1000, 500])
    assert.equal(summary.nbMissing, 2)
    assert.equal(messages.filter(m => m.level === 'warning').length, 2)
  })

  it('fails on any other error, including an HTTP 400 carrying a summary', async () => {
    const axios = fakeAxios({
      'POST /api/v1/datasets/h/_bulk_lines': () => {
        throw Object.assign(new Error('Request failed'), { response: { status: 400, data: { nbOk: 0, nbNotModified: 0, nbErrors: 1, errors: [{ line: 0, error: 'doit être une chaîne', status: 400 }] } } })
      }
    })
    const { log, messages } = recordingLog()
    await assert.rejects(bulkLines(axios, 'h', [{ _action: 'delete', organisme: 'o', siret: '1', code_qualification: 'c', date_debut: '2026-01-01' }], log, () => false), /1 line\(s\) rejected/)
    assert.ok(messages.some(m => m.level === 'error' && m.msg.includes('doit être une chaîne')))
  })

  it('reads the summary of a rejection shaped like a bare response, as lib-processing-dev rejects', async () => {
    const axios = fakeAxios({
      'POST /api/v1/datasets/h/_bulk_lines': () => {
        throw Object.assign(new Error('Request failed'), { status: 400, data: { nbOk: 0, nbNotModified: 0, nbErrors: 1, errors: [{ line: 0, error: 'doit être une chaîne', status: 400 }] } })
      }
    })
    const { log, messages } = recordingLog()
    await assert.rejects(bulkLines(axios, 'h', [{ _action: 'delete', organisme: 'o', siret: '1', code_qualification: 'c', date_debut: '2026-01-01' }], log, () => false), /1 line\(s\) rejected/)
    assert.ok(messages.some(m => m.level === 'error' && m.msg.includes('doit être une chaîne')))
  })

  it('does not upload once stopped', async () => {
    let posted = 0
    const axios = fakeAxios({ 'POST /api/v1/datasets/h/_bulk_lines': () => { posted++; return { nbOk: 1, nbNotModified: 0, nbErrors: 0, errors: [] } } })
    await bulkLines(axios, 'h', [{ _action: 'delete', organisme: 'o', siret: '1', code_qualification: 'c', date_debut: '2026-01-01' }], noopLog, () => true)
    assert.equal(posted, 0)
  })
})
