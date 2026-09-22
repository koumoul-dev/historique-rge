import neostandard from 'neostandard'
import dfLibRecommended from '@data-fair/lib-utils/eslint/recommended.js'

export default [
  { ignores: ['config/*', '**/.type/', 'node_modules/', 'docs/'] },
  ...dfLibRecommended,
  ...neostandard({ ts: true })
]
