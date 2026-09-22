import type { PrepareFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'

// No secret in this plugin: prepare only validates what the JSON schema cannot express.
const prepare: PrepareFunction<ProcessingConfig> = async ({ processingConfig, secrets }) => {
  if (!processingConfig.sourceDatasets?.length) throw new Error('at least one source dataset is required')
  if (processingConfig.sourceDatasets.some(d => d.id === processingConfig.dataset.id)) {
    throw new Error('the history dataset cannot be one of the source datasets')
  }
  return { processingConfig, secrets }
}

export default prepare
