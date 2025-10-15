import { strict } from 'assert'
import pluginConfigSchema from '../plugin-config-schema.json' with { type: 'json' }
import processingConfigSchema from '../processing-config-schema.json' with { type: 'json' }
// import { run } from '../index.ts'

process.env.NODE_ENV = 'test'
// const config = require('config')
// const axios = require('axios')
// const chalk = require('chalk')
// const moment = require('moment')
// const fs = require('fs-extra')
// const assert = require('assert').strict

describe('Hello world processing', () => {
  it('should expose a plugin config schema for super admins', async () => {
    strict.ok(pluginConfigSchema)
  })

  it('should expose a processing config schema for users', async () => {
    strict.ok(processingConfigSchema)
  })
})
