import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { ProcessingConfig } from '../types/processingConfig/index.ts'
import * as plugin from '../index.ts'
import processingConfigSchema from '../processing-config-schema.json' with { type: 'json' }

const validConfig: ProcessingConfig = {
  dataset: { id: 'history', title: 'History' },
  sourceDatasets: [{ id: 'src', title: 'Source' }],
  organisme: 'qualibat',
  mode: 'auto'
}

describe('config schema and prepare', () => {
  it('exposes a processing config schema', () => {
    assert.equal(processingConfigSchema.type, 'object')
  })

  it('accepts a valid config', async () => {
    const res = await plugin.prepare({ processingConfig: { ...validConfig }, secrets: {} })
    assert.deepEqual(res.processingConfig, validConfig)
  })

  it('rejects a config without source dataset', async () => {
    await assert.rejects(
      plugin.prepare({ processingConfig: { ...validConfig, sourceDatasets: [] as unknown as ProcessingConfig['sourceDatasets'] }, secrets: {} }),
      /at least one source dataset/
    )
  })

  it('rejects a config whose history dataset is also a source', async () => {
    await assert.rejects(
      plugin.prepare({ processingConfig: { ...validConfig, sourceDatasets: [{ id: 'history', title: 'History' }] }, secrets: {} }),
      /cannot be one of the source datasets/
    )
  })
})
