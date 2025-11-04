import * as assert from 'assert'
import pluginConfigSchema from '../plugin-config-schema.json' with { type: 'json' }
import processingConfigSchema from '../processing-config-schema.json' with { type: 'json' }
import testsUtils from '@data-fair/lib-processing-dev/tests-utils.js'
import config from 'config'
import * as rgePlugin from '../index.ts'
import { it, describe } from 'node:test'

process.env.NODE_ENV = 'test'

describe('Hello world processing', () => {
  it('should expose a plugin config schema for super admins', async () => {
    assert.strict.ok(pluginConfigSchema)
  })

  it('should expose a processing config schema for users', async () => {
    assert.strict.ok(processingConfigSchema)
  })

  it('should run a task', async function () {
    const context = testsUtils.context({
      pluginConfig: {},
      processingConfig: {
        organisms: [
          'qualifelec'
        ],
        syncWithOld: true,
        updateFromDaily: false,
        forceLinkDatesUpdate: false,
        oldHistoryDataset: {
          title: 'Historique RGE - old',
          id: 'pusi0muwdfrxq4a6ygwrz1b6'
        },
        currentHistoryDataset: {
          title: 'Historique RGE - new',
          id: '9nj6ed-4re2j95njni3qkne7'
        },
        dailyDataset: {
          title: 'liste des entreprises rge opqtecc',
          id: '200yruhxuh0qisjgfzjdum7x'
        }
      },
    }, config, false, false)
    await rgePlugin.run(context)
  })
})
