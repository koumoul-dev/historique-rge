process.env.NODE_ENV = 'test'
// const config = require('config')
// const axios = require('axios')
// const chalk = require('chalk')
// const moment = require('moment')
// const fs = require('fs-extra')
const assert = require('assert').strict
// to work without remote datasets
// const ademeRGE = require('./download-validate')
// const ademeRGE = require('../')

describe('Hello world processing', () => {
  it('should expose a plugin config schema for super admins', async () => {
    const schema = require('../plugin-config-schema.json')
    assert.ok(schema)
  })

  it('should expose a processing config schema for users', async () => {
    const schema = require('../processing-config-schema.json')
    assert.ok(schema)
  })
})
