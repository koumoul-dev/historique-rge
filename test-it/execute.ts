import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '../types/processingConfig/index.ts'
import { run, stop } from '../lib/execute.ts'
import { sourceKeys } from '../lib/types.ts'
import { today } from '../lib/dates.ts'
import { fakeAxios, recordingLog, type FakeRoute } from './utils.ts'
import historySchema from '../resources/schema.json' with { type: 'json' }

const J = today()
const pk = ['siret', 'code_qualification', 'date_debut']
const now = '2026-09-21T10:00:00.000Z'

const srcLine = (siret: string, over: Record<string, unknown> = {}) => ({ siret, code_qualification: 'c', nom_entreprise: 'N' + siret, lien_date_debut: '2025-01-01', lien_date_fin: '2027-01-01', ...over })
const histLine = (siret: string, over: Record<string, unknown> = {}) => ({ ...srcLine(siret), organisme: 'qualibat', date_debut: '2025-01-01', date_fin: '2027-01-01', traitement_termine: false, ...over })

type Setup = { source?: Record<string, unknown>, sourceLines?: unknown[], revisions?: unknown[], secondSourceLines?: unknown[], history?: unknown[], closedToday?: unknown[] }

const setup = (s: Setup) => {
  const posted: unknown[][] = []
  const patches: unknown[] = []
  const routes: Record<string, FakeRoute> = {
    'GET /api/v1/datasets/h': () => ({ id: 'h', title: 'History', isRest: true, schema: historySchema, primaryKey: pk, dataUpdatedAt: now, finalizedAt: now }),
    'GET /api/v1/datasets/s': () => ({ id: 's', title: 'Source', isRest: true, schema: sourceKeys.map(key => ({ key })), rest: { history: true }, primaryKey: ['siret', 'code_qualification'], dataUpdatedAt: now, finalizedAt: now, ...s.source }),
    'GET /api/v1/datasets/s/lines': () => ({ total: (s.sourceLines ?? []).length, results: s.sourceLines ?? [] }),
    'GET /api/v1/datasets/s/revisions': () => ({ total: (s.revisions ?? []).length, results: s.revisions ?? [] }),
    // an optional second source with the same settings, whose revisions cover any window
    'GET /api/v1/datasets/s2': () => ({ id: 's2', title: 'Source 2', isRest: true, schema: sourceKeys.map(key => ({ key })), rest: { history: true }, primaryKey: ['siret', 'code_qualification'], dataUpdatedAt: now, finalizedAt: now }),
    'GET /api/v1/datasets/s2/lines': () => ({ total: (s.secondSourceLines ?? []).length, results: s.secondSourceLines ?? [] }),
    'GET /api/v1/datasets/s2/revisions': () => ({ total: 1, results: [{ _id: 'r0', _updatedAt: '2026-09-20T00:00:00.000Z', siret: '0', code_qualification: 'c' }] }),
    'GET /api/v1/datasets/h/lines': (q) => {
      if (q.get('size') === '0') return { total: (s.history ?? []).length, results: [] }
      const results = q.get('traitement_termine_eq') === 'false' ? (s.history ?? []) : (s.closedToday ?? [])
      return { total: results.length, results }
    },
    'POST /api/v1/datasets/h/_bulk_lines': (_q, body) => { posted.push(body as unknown[]); return { nbOk: (body as unknown[]).length, nbNotModified: 0, nbErrors: 0, errors: [] } }
  }
  const { log, messages } = recordingLog()
  const context = (config: Partial<ProcessingConfig> = {}) => ({
    processingConfig: { dataset: { id: 'h', title: 'History' }, sourceDatasets: [{ id: 's', title: 'Source' }], organisme: 'qualibat', mode: 'auto', ...config },
    pluginConfig: {},
    processingId: 'p',
    dir: '/tmp',
    tmpDir: '/tmp',
    log,
    axios: fakeAxios(routes),
    ws: {},
    sendMail: async () => {},
    patchConfig: async (patch: unknown) => { patches.push(patch) }
  }) as unknown as ProcessingContext<ProcessingConfig>
  return { context, posted, patches, messages }
}

describe('execute', () => {
  it('runs a full synchronisation on the first run and stores the cursor', async () => {
    const { context, posted, patches } = setup({ sourceLines: [srcLine('1'), srcLine('2', { nom_entreprise: 'changed' })], history: [histLine('2'), histLine('3')] })
    await run(context())
    assert.equal(posted.length, 1)
    const actions = (posted[0] as { _action: string, siret?: string }[]).map(op => `${op._action}:${op.siret}`).sort()
    // 1 created, 2 closed + re-created, 3 closed
    assert.deepEqual(actions, ['createOrUpdate:1', 'createOrUpdate:2', 'patch:2', 'patch:3'])
    assert.deepEqual(patches, [{ state: { s: { cursor: now } } }])
  })

  it('runs incrementally when a cursor exists, touching only the modified and deleted keys', async () => {
    const { context, posted } = setup({
      sourceLines: [srcLine('1', { nom_entreprise: 'changed', _updatedAt: now })],
      revisions: [{ _id: 'r2', _updatedAt: now, _deleted: true, siret: '2', code_qualification: 'c' }, { _id: 'r0', _updatedAt: '2026-09-20T00:00:00.000Z', siret: '0', code_qualification: 'c' }],
      history: [histLine('1'), histLine('2'), histLine('9')]
    })
    await run(context({ state: { s: { cursor: '2026-09-21T09:00:00.000Z' } } }))
    const actions = (posted[0] as { _action: string, siret?: string }[]).map(op => `${op._action}:${op.siret}`).sort()
    assert.deepEqual(actions, ['createOrUpdate:1', 'patch:1', 'patch:2'])
  })

  it('falls back to full when the revisions do not cover the window', async () => {
    const { context, posted, messages } = setup({ sourceLines: [srcLine('1')], revisions: [], history: [histLine('9')] })
    await run(context({ state: { s: { cursor: '2026-09-21T09:00:00.000Z' } } }))
    const actions = (posted[0] as { _action: string, siret?: string }[]).map(op => `${op._action}:${op.siret}`).sort()
    assert.deepEqual(actions, ['createOrUpdate:1', 'patch:9'])
    assert.ok(messages.some(m => m.level === 'warning' && m.msg.includes('do not cover')))
  })

  it('writes nothing and still stores the cursor when nothing changed', async () => {
    const { context, posted, patches } = setup({ sourceLines: [srcLine('1')], history: [histLine('1')] })
    await run(context())
    assert.equal(posted.length, 0)
    assert.equal(patches.length, 1)
  })

  it('fails before writing on a duplicate key across sources', async () => {
    const { context, posted } = setup({ sourceLines: [srcLine('1'), srcLine('1')] })
    await assert.rejects(run(context()), /duplicate key/)
    assert.equal(posted.length, 0)
  })

  it('fails before writing on a duplicate modified key across sources in incremental mode', async () => {
    const { context, posted, messages } = setup({
      sourceLines: [srcLine('1', { _updatedAt: now })],
      revisions: [{ _id: 'r0', _updatedAt: '2026-09-20T00:00:00.000Z', siret: '0', code_qualification: 'c' }],
      secondSourceLines: [srcLine('1', { nom_entreprise: 'other', _updatedAt: now })]
    })
    const cursor = '2026-09-21T09:00:00.000Z'
    const ctx = context({ sourceDatasets: [{ id: 's', title: 'Source' }, { id: 's2', title: 'Source 2' }], state: { s: { cursor }, s2: { cursor } } })
    await assert.rejects(run(ctx), /duplicate key 1\|c/)
    assert.equal(posted.length, 0)
    assert.ok(messages.some(m => m.level === 'info' && m.msg === 'Source: incremental'))
    assert.ok(messages.some(m => m.level === 'info' && m.msg === 'Source 2: incremental'))
  })

  it('logs the strategy chosen for each source', async () => {
    const { context, messages } = setup({ sourceLines: [srcLine('1')], history: [histLine('1')] })
    await run(context())
    assert.ok(messages.some(m => m.level === 'info' && m.msg === 'Source: full'))
  })

  it('does not store the cursor when stopped before writing', async () => {
    const { context, posted, patches } = setup({ sourceLines: [srcLine('1')] })
    const ctx = context()
    const originalStep = ctx.log.step
    ctx.log.step = async (msg) => { if (msg.startsWith('Computing')) await stop(); return originalStep(msg) }
    await run(ctx)
    assert.equal(posted.length, 0)
    assert.equal(patches.length, 0)
  })

  it('synchronises a file source whose upload dropped an optional column, emptying it in the history', async () => {
    const { context, posted, messages } = setup({
      source: { isRest: false, rest: undefined, file: { name: 'rge.csv' }, schema: sourceKeys.filter(k => k !== 'email').map(key => ({ key })) },
      sourceLines: [srcLine('1')],
      history: [histLine('1', { date_debut: J, email: 'a@one.fr' })]
    })
    await run(context({ state: { s: { cursor: '2026-09-21T09:00:00.000Z' } } }))
    assert.ok(messages.some(m => m.level === 'warning' && m.msg.includes('optional column')))
    assert.ok(messages.some(m => m.level === 'info' && m.msg === 'Source: full'))
    assert.deepEqual((posted[0] as { _action: string, siret: string, email?: unknown }[]).map(op => [op._action, op.siret, op.email]), [['patch', '1', null]])
  })

  it('processes today lines consistently: a line opened today and gone is deleted', async () => {
    const { context, posted } = setup({ sourceLines: [], history: [histLine('1', { date_debut: J })] })
    await run(context())
    assert.deepEqual(posted[0], [{ _action: 'delete', siret: '1', code_qualification: 'c', date_debut: J }])
  })
})
