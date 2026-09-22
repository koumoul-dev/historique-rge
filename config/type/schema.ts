export default {
  $id: 'https://github.com/koumoul-dev/historique-rge/config',
  'x-exports': ['types', 'validate'],
  type: 'object',
  title: 'Config',
  additionalProperties: false,
  required: [
    'dataFairUrl',
    'dataFairAPIKey'
  ],
  properties: {
    dataFairUrl: { type: 'string' },
    dataFairAPIKey: { type: 'string' }
  }
}
