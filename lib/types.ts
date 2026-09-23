export const sourceKeys = [
  'siret', 'nom_entreprise', 'adresse', 'code_postal', 'commune', 'latitude', 'longitude',
  'telephone', 'email', 'site_internet', 'code_qualification', 'nom_qualification',
  'url_qualification', 'nom_certificat', 'domaine', 'meta_domaine', 'particulier',
  'lien_date_debut', 'lien_date_fin'
] as const
export type SourceKey = typeof sourceKeys[number]

// optional in the ADEME file format: a file upload leaving one of them empty drops the column from the dataset
export const optionalSourceKeys: readonly SourceKey[] = ['telephone', 'email', 'site_internet']

// a change on one of these opens a new history line
export const comparedKeys: readonly SourceKey[] = [
  'siret', 'nom_entreprise', 'adresse', 'code_postal', 'commune', 'latitude', 'longitude',
  'telephone', 'email', 'site_internet', 'url_qualification', 'nom_certificat', 'particulier'
]
// these are patched on the current line without opening a new one
export const linkKeys: readonly SourceKey[] = ['lien_date_debut', 'lien_date_fin']
export const descriptiveKeys: readonly SourceKey[] = ['nom_qualification', 'domaine', 'meta_domaine']

// code_qualification belongs to one organism: the organism is not part of the key
export const primaryKey = ['siret', 'code_qualification', 'date_debut'] as const

export type SourceLine = { [K in SourceKey]?: unknown } & { siret: string, code_qualification: string, _updatedAt?: string }

export type HistoryLine = SourceLine & {
  organisme: string
  date_debut: string
  date_fin?: string
  motif_insertion?: string
  traitement_termine: boolean
}

export type LineRef = { siret: string, code_qualification: string, date_debut: string }

export type BulkOp =
  | ({ _action: 'createOrUpdate' } & HistoryLine)
  | ({ _action: 'patch' } & LineRef & { [key: string]: unknown })
  | ({ _action: 'delete' } & LineRef)

/** Per key: the current line and/or the line closed today (both may exist). */
export type PreviousState = Map<string, { current?: HistoryLine, closedToday?: HistoryLine }>
export type CurrentState = Map<string, SourceLine>

export const lineKey = (line: { siret: unknown, code_qualification: unknown }): string => `${line.siret}|${line.code_qualification}`

export const lineRef = (line: HistoryLine): LineRef => ({
  siret: line.siret,
  code_qualification: line.code_qualification,
  date_debut: line.date_debut
})
