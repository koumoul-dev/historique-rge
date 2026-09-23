# historique-rge

data-fair processing plugin. One instance per qualification organism (OQ) keeps the editable
dataset "Historique des entreprises RGE depuis 2014" in sync with the datasets the OQ fills in
data-fair (RGE companies, foreign companies).

## How it works

- **Previous state**: the history lines of the organism that are current
  (`traitement_termine = false`) plus those closed today.
- **Current state**: the lines of the source datasets — all of them (full run), or only the
  lines updated since the last run plus the deletions found in `/revisions` (incremental run).
  An incremental run requires every source to be an editable dataset with line history
  **and** a primary key containing `siret` and `code_qualification`: data-fair keeps only the
  primary key fields on a deleted revision, so without that key the deletions could not be
  matched to the history (the line history is then ignored, with a warning, and the run is
  full).
- **Diff**, at daily granularity in the Europe/Paris timezone. The history always equals what
  a once-a-day synchronisation would produce if the day ended now:
  - new key → line created with `date_debut` = today, `date_fin` = `lien_date_fin`;
  - change on `siret nom_entreprise adresse code_postal commune latitude longitude telephone
    email site_internet url_qualification nom_certificat particulier` → the current line is
    closed (`traitement_termine = true`, `date_fin` = yesterday) and a new one is created with
    the changed fields in `motif_insertion`; a line opened today is instead patched in place
    as soon as **any** of the 19 source fields changed (not only the 13 compared ones), with
    `motif_insertion` recomputed against the line closed today, if any;
  - change on `lien_date_debut`, `lien_date_fin`, `nom_qualification`, `domaine`,
    `meta_domaine` only → patched on the current line;
  - key gone → the current line is closed, or deleted if it was opened today;
  - key back with identical data after being closed today → the line is reopened.
  Fields are compared as text, `undefined`, `null`, `''` and `false` all counting as empty
  (like the legacy flow); `latitude` and `longitude` are compared by numeric value.
- **Write**: `_bulk_lines` on the history, chunks of 1000, addressed by the primary key
  `siret, code_qualification, date_debut`. Every operation is idempotent; the run
  fails if a line is rejected and the cursor is not advanced. A 404 on a patch or a delete
  means the line was already handled by a previous run (e.g. a retried webhook): it is logged
  as a warning, not a failure.
- **Cursor**: the source `dataUpdatedAt` observed at the start of a successful run, stored in
  the processing config (`state`). The next incremental run reads from that date minus 15
  minutes.

A source dataset must expose the 19 columns of the ADEME format. `telephone`, `email` and
`site_internet` are optional: data-fair drops a column from a file dataset when a new upload
leaves it entirely empty, so a missing one is read as empty (with a warning) instead of
failing the run. The other columns are mandatory and a missing one fails the run before any
write. On a file dataset, number-looking columns (`siret`, `code_postal`, `telephone`) must
carry `x-transform: { type: 'string' }` in the dataset schema, otherwise data-fair infers
integers and leading zeros are lost.

## Setting up an organism

Cut-over from the daily `ademe-rge` flow, in this order:

1. Create the new history dataset once (editable, the 24 columns of `resources/schema.json`,
   primary key `siret, code_qualification, date_debut`), backfill it from the old
   history dataset, then switch the slug to the new one. Every backfilled line must carry
   `traitement_termine` (`false` for a current line, `true` for a closed one): a line without
   it is invisible to the `traitement_termine_eq=false` query and would stay open forever.
2. Remove the organism's folder from the `folders` config of the `ademe-rge` processing
   **before** the first run, otherwise both flows write the same organism.
3. Create a processing with this plugin: history dataset, the organism's datasets, the
   organism, mode `full`. Run it once, then switch the mode to `auto`.
4. On each source dataset, subscribe the processing trigger URL (processing page → webhook)
   to the "data updated" webhook (dataset "Webhooks" tab, topic `dataset-data-updated`).
5. Optional: add a daily schedule to the processing as a safety net, in case a webhook is
   dropped after its retries.

Processings refuses a trigger while a run is in progress; the events service retries later.

## Development

```
npm install
npm run build-types   # after every change of processing-config-schema.json
npm run lint
npm test              # unit tests; test-it/integration.ts needs config/local-test.mjs
```

`config/local-test.mjs` (gitignored) mirrors `config/default.mjs` with a data-fair URL and API key.

## Release

Every push on `main` publishes to the staging registry; pushing a `v*` tag matching the
version in `package.json` publishes to the production registry (see `.github/workflows`).
