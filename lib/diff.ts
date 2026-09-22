import type { BulkOp, CurrentState, HistoryLine, PreviousState, SourceKey, SourceLine } from './types.ts'
import { comparedKeys, descriptiveKeys, lineRef, linkKeys, sourceKeys } from './types.ts'
import { dayBefore } from './dates.ts'

export type DiffStats = { created: number, closed: number, updated: number, reopened: number, deleted: number, unchanged: number }

// only the coordinates are compared by value: siret and code_postal keep their leading zeros
const numericKeys: readonly SourceKey[] = ['latitude', 'longitude']

// the legacy flow compared with (a || '') !== (b || ''): false counts as empty
const norm = (value: unknown, key?: SourceKey): string => {
  if (value === undefined || value === null || value === false) return ''
  const str = String(value)
  if (key && numericKeys.includes(key) && str.trim() !== '' && Number.isFinite(Number(str))) return String(Number(str))
  return str
}

// a patch removes an emptied/missing field with null instead of dropping the key
const orNull = (value: unknown): unknown => norm(value) === '' ? null : value

const changedKeys = (a: SourceLine, b: SourceLine, keys: readonly SourceKey[]): SourceKey[] =>
  keys.filter(k => norm(a[k], k) !== norm(b[k], k))

// values written on a new line: empty values are simply absent
const sourceValues = (line: SourceLine): Partial<SourceLine> => {
  const out: Record<string, unknown> = {}
  for (const k of sourceKeys) if (norm(line[k]) !== '') out[k] = line[k]
  return out as Partial<SourceLine>
}

// values written by a patch: an emptied field is removed with null
const sourcePatch = (line: SourceLine): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of sourceKeys) out[k] = orNull(line[k])
  return out
}

const dateFin = (line: SourceLine): string | undefined => norm(line.lien_date_fin) === '' ? undefined : line.lien_date_fin as string

const linkPatch = (line: SourceLine): Record<string, unknown> => {
  const out: Record<string, unknown> = { date_fin: orNull(line.lien_date_fin) }
  for (const k of [...linkKeys, ...descriptiveKeys]) out[k] = orNull(line[k])
  return out
}

export const diff = (previous: PreviousState, current: CurrentState, organisme: string, today: string, keys?: Iterable<string>) => {
  const ops: BulkOp[] = []
  const stats: DiffStats = { created: 0, closed: 0, updated: 0, reopened: 0, deleted: 0, unchanged: 0 }
  const yesterday = dayBefore(today)
  const keySet = keys ? new Set(keys) : new Set([...previous.keys(), ...current.keys()])

  const create = (cur: SourceLine, motives: SourceKey[] = []) => {
    const line: HistoryLine = { ...sourceValues(cur), siret: cur.siret, code_qualification: cur.code_qualification, organisme, date_debut: today, traitement_termine: false }
    const end = dateFin(cur)
    if (end !== undefined) line.date_fin = end
    if (motives.length) line.motif_insertion = motives.join(';')
    ops.push({ _action: 'createOrUpdate', ...line })
    stats.created++
  }
  const close = (line: HistoryLine) => {
    ops.push({ _action: 'patch', ...lineRef(line), traitement_termine: true, date_fin: yesterday })
    stats.closed++
  }
  const reopen = (closed: HistoryLine, cur: SourceLine) => {
    ops.push({ _action: 'patch', ...lineRef(closed), traitement_termine: false, ...linkPatch(cur) })
    stats.reopened++
  }

  for (const key of keySet) {
    const cur = current.get(key)
    const { current: prev, closedToday } = previous.get(key) ?? {}

    if (!cur) {
      if (!prev) continue
      if (prev.date_debut === today) {
        ops.push({ _action: 'delete', ...lineRef(prev) })
        stats.deleted++
      } else {
        close(prev)
      }
      continue
    }

    if (prev && prev.date_debut !== today) {
      const changes = changedKeys(prev, cur, comparedKeys)
      if (changes.length) {
        close(prev)
        create(cur, changes)
      } else if (changedKeys(prev, cur, [...linkKeys, ...descriptiveKeys]).length) {
        ops.push({ _action: 'patch', ...lineRef(prev), ...linkPatch(cur) })
        stats.updated++
      } else {
        stats.unchanged++
      }
    } else if (prev) {
      // the line was opened today: the daily flow would only ever see its final state
      if (closedToday && !changedKeys(closedToday, cur, comparedKeys).length) {
        ops.push({ _action: 'delete', ...lineRef(prev) })
        stats.deleted++
        reopen(closedToday, cur)
      } else if (changedKeys(prev, cur, sourceKeys).length) {
        const patch: Record<string, unknown> = { _action: 'patch', ...lineRef(prev), ...sourcePatch(cur), date_fin: orNull(cur.lien_date_fin) }
        if (closedToday) patch.motif_insertion = changedKeys(closedToday, cur, comparedKeys).join(';')
        ops.push(patch as BulkOp)
        stats.updated++
      } else {
        stats.unchanged++
      }
    } else if (closedToday) {
      const changes = changedKeys(closedToday, cur, comparedKeys)
      if (changes.length) create(cur, changes)
      else reopen(closedToday, cur)
    } else {
      create(cur)
    }
  }

  return { ops, stats }
}
