# Contributing

Thanks for helping improve i18n-check. Bug reports with a small
reproduction, new extractors, new checks, fixture cases and documentation
fixes are all welcome. New to open source? Issues labelled
**good first issue** are small and come with pointers. Contributions from
translators are especially valuable: tell us where a check is wrong for your
language.

## Reporting a bug

Open an issue with:

- the command you ran and the output you expected
- the smallest locale files and source snippet that reproduce it (a few
  lines are usually enough; `i18n-check extract --format json` shows what the
  extractor found)
- the library you use (i18next, vue-i18n, ...) and its version
- your i18n-check and Node versions

## Development setup

You need Node 20 or newer.

```console
$ git clone https://github.com/saizul/i18n-check.git
$ cd i18n-check
$ npm ci
$ npm test              # builds ESM + CJS, compiles the tests and runs node:test
$ npm run lint          # biome lint + tsc --noEmit
$ npm run format        # biome format --write
$ npm run format:check  # what CI runs
```

Try the CLI from the build: `node dist/esm/cli.js --cwd test/fixtures/react-i18next`.

## Guidelines

- **Zero runtime dependencies.** Only the Node standard library. Parsers stay
  small and tested instead of pulling in YAML or AST libraries.
- **Every extractor has a fixture project** in `test/fixtures/<name>/` with a
  `package.json`, at least two locales (one of them `bn` is a good habit) and
  sources that use static, namespaced, dynamic and missing keys.
- **Every check has a failing and a passing test.** False positives are
  worse than misses: when unsure, make a rule `info` by default.
- **IDs are public API.** Rule and extractor IDs are used in configs, so do
  not rename them outside a major release.
- **Unicode first.** Use `\p{L}`-style regular expressions, never `[a-zA-Z]`,
  for anything that looks at translated text.
- Every change comes with a test and a line in the `Unreleased` section of
  `CHANGELOG.md`. The README explains how to add an extractor or a check.

## Project layout

```text
src/
  analyze.ts       the pipeline: catalog -> usage scan -> checks -> stats
  locales/         discovery, JSON / YAML / PO parsers and writers, the catalog
  extractors/      one file per library, plus source.ts (tokenizer) and common.ts
  message/         ICU parser, placeholder extraction, plural categories
  checks/          rule definitions (builtin.ts) and the runner (index.ts)
  report/          pretty, JSON, Markdown and GitHub output
  fix.ts           the fix command
  cli.ts, cli/     command-line interface
test/              node:test suites; fixtures/ has one project per extractor
examples/          Bangla example apps, config, workflow, API usage
```

## Pull requests

Keep them focused: one fix or feature per pull request, with a description
of what changed and how you tested it. CI runs lint, format check and the
tests on Node 20 and 22 on Linux, and Node 22 on Windows and macOS.
