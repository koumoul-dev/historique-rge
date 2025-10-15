# ADEME RGE processing script

Generates an historical file from data from qualification organisms

## Running tests

Install dependencies:

```
npm install
```

Create a `config/local-test.js` file with the same structure as `config/default.js` but with filled values.
Then run the test suite:

```
npm test
```

## Release

Processing plugins are fetched from the npm registry with a filter on keyword "data-fair-processings-plugin". So publishing a plugin is as simple as publishing the npm package:

```
npm version minor
npm publish
git push && git push --tags
```

To publish a test version, use prerelease versioning with a "test" npm tag:

```
# new prerelease
npm version preminor --preid=beta
# increment prerelease
npm version prerelease --preid=beta
npm publish --tag=test
git push && git push --tags
```