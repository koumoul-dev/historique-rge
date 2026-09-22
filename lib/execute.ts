import type { RunFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'

let shouldBeStopped = false
export const isStopped = () => shouldBeStopped
export const stop = async () => { shouldBeStopped = true }

export const run: RunFunction<ProcessingConfig> = async (context) => {
  shouldBeStopped = false
  await context.log.step('Not implemented yet')
}
