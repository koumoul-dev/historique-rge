import type { PrepareFunction, RunFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from './types/processingConfig/index.ts'

/** Validates the config when it is saved. */
export const prepare: PrepareFunction<ProcessingConfig> = async (context) => {
  const prepare = (await import('./lib/prepare.ts')).default
  return prepare(context)
}

/** Runs the history synchronisation for one organism. */
export const run: RunFunction<ProcessingConfig> = async (context) => {
  const { run } = await import('./lib/execute.ts')
  return run(context)
}

/** Asks the current run to stop as soon as possible. */
export const stop = async () => {
  const { stop } = await import('./lib/execute.ts')
  return stop()
}
