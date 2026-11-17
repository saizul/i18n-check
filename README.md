# i18n-check

[![CI](https://github.com/saizul/i18n-check/actions/workflows/ci.yml/badge.svg)](https://github.com/saizul/i18n-check/actions/workflows/ci.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-blue)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![TypeScript](https://img.shields.io/badge/types-included-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

Find missing, unused and inconsistent translation keys in JavaScript and
TypeScript projects, before your users do.

i18n-check reads your locale files (JSON, YAML or gettext `.po`), scans your
source code for the keys it uses, and reports:

- keys **missing** in a locale, compared to the base locale
- keys **used in code but defined nowhere**
- keys **defined but never used**
- **placeholder mismatches** (`{name}`, `{{name}}`, `%s`, `<tag>`, `$t(...)`, `@:key`)
- **ICU syntax errors** and **plural forms** a language needs but lacks
  (Arabic needs six, Bangla two; taken from `Intl.PluralRules`)
- **empty** values, values **identical to the base** (probably untranslated),
  **duplicate keys** and keys that exist only in one locale

It understands i18next / react-i18next, vue-i18n, next-intl,
react-intl (FormatJS), Angular ngx-translate and any plain `t()` function,
including namespaces and dynamic keys. Output for the terminal, JSON,
Markdown and GitHub Actions annotations, and a `fix` command that adds
missing keys, removes unused ones and sorts files.

Zero runtime dependencies, Unicode-safe (it is tested with Bangla), ESM and
CommonJS builds with type declarations.

```console
$ npx @saizul/i18n-check
Base locale en · i18next · i18next placeholders

Locale  Keys   Missing  Empty  Coverage
en*       14         0      0  100.0% ██████████
ar        12         3      0   78.5% ████████░░
bn        13         2      1   78.5% ████████░░

error missing-key (5)
  auth:login.button is missing in ar (en: "Sign in")  public/locales/en/auth.json:3
  auth:logout is missing in bn (en: "Sign out")  public/locales/bn/auth.json
  common:legacy is missing in bn (en: "Old banner")  public/locales/bn/common.json
  ...

error undefined-key (1)
  common:missing.in.base is used but not defined in any locale  src/App.tsx:15

error placeholder-mismatch (1)
  common:title in ar lacks {{name}} and adds {{user}} (en: "Welcome, {{name}}!")  public/locales/ar/common.json:2

warning plural-forms (1)
  common:items in ar lacks the plural forms _zero, _two, _many (ar uses zero, one, two, few, many, other)  public/locales/ar/common.json

warning unused-key (2)
  common:legacy is not used in the code  public/locales/en/common.json:15
  common:brand is not used in the code  public/locales/en/common.json:16

info dynamic-key (1)
  Dynamic key `status.${status}`, skipped; keys starting with "status." count as used  src/App.tsx:10

✖ 7 errors, 5 warnings, 4 info · 3 locales, 14 keys, 2 source files
```

## Contents

- [Quick start](#quick-start)
- [Install](#install)
- [Supported libraries](#supported-libraries)
- [Locale files and layouts](#locale-files-and-layouts)
- [Rules](#rules)
- [CLI](#cli)
- [The fix command](#the-fix-command)
- [Configuration](#configuration)
- [CI and GitHub Actions](#ci-and-github-actions)
- [API](#api)
- [Examples](#examples)
- [Bangla and other scripts](#bangla-and-other-scripts)
- [Contributing: add an extractor or a check](#contributing-add-an-extractor-or-a-check)
- [Roadmap](#roadmap)
- [Limitations](#limitations)

## Quick start

In most projects no configuration is needed: the locale layout is detected
from common folders, and the extractor from your `package.json`.

```console
$ npx @saizul/i18n-check                     # report problems
$ npx @saizul/i18n-check fix --dry-run       # what fix would add and sort
$ npx @saizul/i18n-check fix                 # add missing keys (base text) and sort
$ npx @saizul/i18n-check --format github     # annotations in GitHub Actions
```

When the detection guesses wrong, point it at your files:

```console
$ npx @saizul/i18n-check --locales "src/i18n/{locale}/{namespace}.json" --src "src/**/*.tsx" --base en
```

## Install

The package is published to GitHub Packages as `@saizul/i18n-check`. Add
this line to an `.npmrc` in your project (or your home directory):

```ini
@saizul:registry=https://npm.pkg.github.com
```

GitHub Packages asks for a token even for public packages: create a personal
access token with the `read:packages` scope, export it as `NODE_AUTH_TOKEN`
and reference it:

```ini
@saizul:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```console
$ npm install --save-dev @saizul/i18n-check
```

Then add a script:

```json
{ "scripts": { "i18n:check": "i18n-check", "i18n:fix": "i18n-check fix" } }
```

Requires Node 20 or newer.

## Supported libraries

| ID              | Library                  | Finds                                                                                     |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `i18next`       | i18next, react-i18next, next-i18next | `t('key')`, `t('ns:key')`, `t('key', { ns, count })`, `i18n.t()`, `useTranslation('ns', { keyPrefix })`, `withTranslation`, `getFixedT`, `<Trans i18nKey="key" ns="ns">` |
| `vue-i18n`      | vue-i18n, Nuxt i18n      | `$t`, `t` from `useI18n()`, `$tc`, `$te`, `$tm`, `i18n.global.t`, `v-t="'key'"`, `v-t="{ path }"`, `<i18n-t keypath>`, in `<template>` and `<script>` |
| `next-intl`     | next-intl, use-intl      | `useTranslations('Ns')`, `getTranslations('Ns')` / `({ namespace })`, then `t()`, `t.rich()`, `t.markup()`, `t.raw()`, `t.has()`, per translator variable |
| `react-intl`    | react-intl, FormatJS     | `id` in `defineMessages`, `defineMessage`, `formatMessage({ id })`, `<FormattedMessage id>` |
| `ngx-translate` | Angular ngx-translate    | `'KEY' \| translate`, `[translate]="'KEY'"`, `<p translate>KEY</p>`, `translate="KEY"`, `translate.instant/get/stream()`, `marker()`, inline templates |
| `generic`       | anything with a `t()`    | the functions in `functions` (default `t`, `$t`, `__`, `i18n.t`, `translate`), in scripts, `.vue`, `.svelte`, `.astro` and `.html` |

Extractors are chosen from the dependencies in `package.json`; set
`extractors` (or `--extractor`) to override. Several can run at once.

Extraction uses a small tokenizer rather than a full parser: comments are
ignored, strings and template literals are understood, `function t()`
declarations are skipped, and apostrophes in JSX text (`<p>Don't</p>`) do not
confuse it.

**Dynamic keys** such as `` t(`status.${s}`) `` or `t('menu.' + id)` are
reported as `dynamic-key` (info) with their location and skipped. Keys that
start with the static part (`status.`) count as used, so they are not
reported as unused; turn that off with `"dynamicPrefixAsUsed": false`.

Other usage that counts: plural forms (`t('items', { count })` uses
`items_one`, `items_other`, ...), objects (`t('errors', { returnObjects: true })`
or `$tm('list')` use every key below), i18next nesting (`$t(other.key)` inside
a value) and vue-i18n linked messages (`@:other.key`).

## Locale files and layouts

| Format | Notes |
| ------ | ----- |
| JSON   | Nested or flat (`"home.title": "..."`). Duplicate keys are reported with line numbers (JSON.parse would hide them). Comments and trailing commas are tolerated. |
| YAML   | A built-in subset parser: nested maps, quoted and plain scalars, block scalars (`\|`, `>`), sequences, comments, Rails-style `en:` roots. No dependency needed. |
| PO     | gettext `msgid`/`msgstr`, `msgctxt` (key `context\|msgid`), plurals and `#, fuzzy` (counted as empty). The base locale uses `msgid` as its text. Read-only. |

Detected layouts (first match with two or more locales wins):

```text
public/locales/{locale}/{namespace}.json     locales/{locale}.json
locales/{locale}/{namespace}.json            messages/{locale}.json        (next-intl)
src/locales/{locale}/{namespace}.json        src/locales/{locale}.json
src/i18n/locales/{locale}/{namespace}.json   src/i18n/{locale}.json
locale/{locale}/LC_MESSAGES/{namespace}.po   src/assets/i18n/{locale}.json (Angular)
lang/{locale}.json  i18n/{locale}.json  translations/{locale}.json  config/locales/{locale}.yml ...
```

Every `.json` above may also be `.yaml`, `.yml` or `.po`. With `{namespace}`
in the path, keys are reported as `namespace:key` (i18next style) and keys
without a namespace in code use `defaultNamespace` (default `translation`,
`common` or the first namespace). Locale codes such as `bn`, `bn-BD`,
`pt_BR`, `zh-Hant-TW` and `es-419` are recognized.

The base locale is `baseLocale`, else `en` (or `en-*`), else the locale with
the most keys.

## Rules

| ID                     | Default | Reports                                                                    |
| ---------------------- | ------- | -------------------------------------------------------------------------- |
| `parse-error`          | error   | A locale file that cannot be read                                          |
| `duplicate-key`        | error   | A key defined twice in one file, or once nested and once flat             |
| `missing-key`          | error   | A base key missing in a locale (plural forms the locale does not use are skipped) |
| `undefined-key`        | error   | A key used in code that the base locale does not define                    |
| `placeholder-mismatch` | error   | A translation that drops or adds a placeholder                             |
| `icu-syntax`           | error   | An ICU message that does not parse, or a plural without `other`           |
| `plural-forms`         | warning | A plural lacking a category the locale needs (CLDR via `Intl.PluralRules`) |
| `empty-value`          | warning | An empty translation (or a fuzzy `.po` entry)                              |
| `extra-key`            | warning | A key that only exists in a non-base locale                                |
| `unused-key`           | warning | A base key that no scanned source file uses                                |
| `untranslated`         | info    | A translation identical to the base text (words only; placeholders, numbers and URLs are ignored) |
| `dynamic-key`          | info    | A computed key that was skipped                                            |

`i18n-check --list-rules` prints the same list. Change a severity or turn a
rule off with `"rules": { "unused-key": "off" }` or `--rule unused-key=off`.

Placeholder syntax follows the library (`messageFormat`):

| Format    | Used by                        | Placeholders compared                                  |
| --------- | ------------------------------ | ------------------------------------------------------ |
| `i18next` | i18next, ngx-translate         | `{{name}}`, `{{name, format}}`, `{{- raw}}`, `$t(key)` |
| `vue`     | vue-i18n                       | `{name}`, `{0}`, `@:linked.key`                        |
| `icu`     | next-intl, react-intl          | ICU arguments (`{n, plural, ...}` by name), rich text tags `<b>` |
| `printf`  | gettext, sprintf               | `%s`, `%d`, `%1$s`, `%(name)s` (counted)               |
| `auto`    | mixed or generic projects      | `{{x}}`, `{x}` and printf tokens                       |

Singular plural forms may drop the count (`"items_one": "one item"`), so a
missing `{{count}}` in `_zero`, `_one` and `_two` forms is not reported.

## CLI

```text
i18n-check [check] [options]     Report problems (default command)
i18n-check fix [options]         Sort keys, add missing keys, remove unused ones
i18n-check extract [options]     List the keys found in the source code
```

| Option                   | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `--locales <pattern>`    | Locale files with `{locale}`, `{namespace}`, `{ext}`, `*`, `**` (repeatable) |
| `--base <locale>`        | Base locale                                                              |
| `--only-locales <list>`  | Check only these locales (comma-separated)                               |
| `--src <glob>`           | Source files (repeatable; default all JS/TS/Vue/Svelte/Astro/HTML)        |
| `--exclude <glob>`       | Source files to skip (repeatable; tests, stories and `.d.ts` are skipped by default) |
| `--extractor <id>`       | Extractor(s) to use (repeatable)                                         |
| `--functions <list>`     | Translate function names, e.g. `t,i18n.t,__`                             |
| `--no-source`            | Skip the source scan (no unused / undefined / dynamic checks)             |
| `--format <f>`           | `pretty` (default), `json`, `markdown`, `github`                         |
| `--output <file>`        | Also append the report to a file; pretty becomes Markdown there          |
| `--min-severity <s>`     | Hide less severe issues in pretty output                                 |
| `--fail-on <s>`          | Exit 1 at `error` (default), `warning`, `info`, or never with `none`    |
| `--rule <id=severity>`   | Override a rule (repeatable)                                             |
| `--only <list>`          | Run only these rules                                                     |
| `--list-rules`, `--list-extractors` | Show what is available                                        |
| `--cwd`, `--config`, `--no-color`, `-h`, `-v` | The usual                                           |

Exit codes: `0` no problems at the `--fail-on` level, `1` problems found,
`2` usage or configuration error.

`extract` prints every key found in the code (one per line, or JSON with
`--format json` including locations and dynamic keys), handy for debugging an
extractor or feeding other tools.

## The fix command

```console
$ i18n-check fix                        # = --add-missing --sort
$ i18n-check fix --dry-run              # list the changes, write nothing
$ i18n-check fix --add-missing --fill empty      # add "" instead of the base text
$ i18n-check fix --add-missing --fill key        # add the key itself as the value
$ i18n-check fix --remove-unused --dry-run       # unused keys, from every locale
$ i18n-check fix --remove-extra                  # keys the base locale does not have
$ i18n-check fix --add-missing --no-sort
```

```text
$ i18n-check fix --add-missing --no-sort
create public/locales/ar/auth.json  +3
update public/locales/bn/auth.json  +1
update public/locales/bn/common.json  +1
Changed 3 files: 5 keys added, 0 removed
```

- Missing namespace files are created next to the base file
  (`locales/en/admin.json` -> `locales/bn/admin.json`).
- JSON keeps its indentation, final newline and flat or nested style; YAML is
  rewritten with two-space indentation (comments are not kept) and Rails
  roots are preserved. `.po` files and files with syntax errors are never
  touched.
- Plural forms a locale does not use are not added (no `_one` for Japanese).
- `--remove-unused` needs a source scan and respects `ignoreUnused` and
  dynamic prefixes. Run it with `--dry-run` first and commit before you run
  it for real.

## Configuration

`i18n-check.config.json` in the project root (or `--config <file>`). CLI
flags win. Unknown options are an error, so typos are caught.

```json
{
  "locales": "public/locales/{locale}/{namespace}.json",
  "baseLocale": "en",
  "onlyLocales": ["bn", "hi", "ar"],
  "src": ["src/**/*.{ts,tsx}"],
  "exclude": ["src/legacy/**"],
  "extractors": ["i18next"],
  "functions": ["t", "i18n.t"],
  "defaultNamespace": "common",
  "namespaceSeparator": ":",
  "keySeparator": ".",
  "messageFormat": "auto",
  "rules": { "unused-key": "error", "untranslated": "warning", "dynamic-key": "off" },
  "ignoreKeys": ["debug:*"],
  "ignoreUnused": ["common:errors.*"],
  "ignoreUntranslated": ["common:brand", "*.email"],
  "dynamicPrefixAsUsed": true,
  "fix": { "fill": "base", "sort": true }
}
```

| Key                   | Default        | Meaning                                                      |
| --------------------- | -------------- | ------------------------------------------------------------ |
| `locales`             | detected       | Pattern(s) for locale files                                  |
| `baseLocale`          | `en` / most keys | Locale the others are compared to                          |
| `onlyLocales`         | all            | Check only these locales                                     |
| `src` / `exclude`     | all sources    | Globs for the source scan                                    |
| `extractors`          | detected       | Extractor IDs                                                |
| `functions`           | per extractor  | Translate function names                                     |
| `defaultNamespace`    | detected       | Namespace for keys without one                               |
| `namespaceSeparator`  | `:`            | Between namespace and key                                    |
| `keySeparator`        | `.`            | Between nested segments                                      |
| `messageFormat`       | from extractor | `icu`, `i18next`, `vue`, `printf` or `auto`                  |
| `rules`               | defaults above | Severity per rule, or `off`                                  |
| `ignoreKeys`          | none           | Keys every rule ignores (`*` wildcard)                       |
| `ignoreUnused`        | none           | Keys never reported as unused (loaded from a CMS, the server, ...) |
| `ignoreUntranslated`  | none           | Keys that may equal the base (brand names, "OK")             |
| `dynamicPrefixAsUsed` | `true`         | Static prefixes of dynamic keys mark keys as used            |
| `fix.fill`            | `base`         | Value for added keys: `base`, `empty` or `key`               |
| `fix.sort`            | `true`         | Sort keys when fixing                                        |

## CI and GitHub Actions

```yaml
- run: npx i18n-check --format github
- if: always()
  run: npx i18n-check --format markdown --output "$GITHUB_STEP_SUMMARY" --fail-on none > /dev/null
```

The first step annotates the exact lines in the pull request; the second
adds a coverage table to the job summary. The complete workflow, including
installing from GitHub Packages, is in
[examples/github-workflow.yml](examples/github-workflow.yml).

To keep CI green while you clean up, start with
`--fail-on none` or `"rules": { "unused-key": "info" }` and tighten later.

## API

```ts
import { analyze, formatMarkdown } from '@saizul/i18n-check';

const result = analyze({ cwd: process.cwd(), baseLocale: 'en', rules: { untranslated: 'off' } });
result.issues; // [{ rule, severity, message, key, locale, file, line, column }]
result.stats; //  [{ locale, keys, translated, missing, empty, coverage }]
console.log(formatMarkdown(result));
```

| Export                                         | Description                                              |
| ---------------------------------------------- | -------------------------------------------------------- |
| `analyze(options)`                             | Load locales, scan sources, run checks                   |
| `planFixes(result, options, cwd)` / `applyFixes(changes, cwd)` | What `fix` does, without or with writing  |
| `loadCatalog(options)` / `discoverLocaleFiles(cwd, patterns)` | Locale files and their entries             |
| `scanUsage(cwd, extractors, options)`          | Used and dynamic keys in source files                    |
| `builtinExtractors`, `registerExtractor()`, `getExtractor()`, `detectExtractors()` | Extractors      |
| `builtinChecks`, `registerCheck()`, `runChecks()`, `buildContext()` | Checks                                |
| `parseJsonTree`, `parseYamlTree`, `parsePo`, `stringifyJsonTree`, `stringifyYamlTree` | File formats       |
| `parseIcu`, `extractPlaceholders`, `comparePlaceholders`, `pluralCategories` | Message helpers             |
| `formatPretty`, `formatJson`, `formatMarkdown`, `formatGithub` | Reporters                                  |
| `maskJs`, `findCalls`, `readStringArg`, `LineIndex` | Tokenizer helpers for writing extractors            |

## Examples

| Folder / file                                                | Shows                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| [examples/bangla-react](examples/bangla-react)               | react-i18next with English and Bangla, namespaces, plurals, a dynamic key |
| [examples/next-intl-bn](examples/next-intl-bn)               | next-intl with ICU plurals and rich text in Bangla      |
| [examples/api.mjs](examples/api.mjs)                         | The programmatic API                                    |
| [examples/commonjs.cjs](examples/commonjs.cjs)               | `require()` usage                                       |
| [examples/i18n-check.config.json](examples/i18n-check.config.json) | Every config option                               |
| [examples/github-workflow.yml](examples/github-workflow.yml) | CI with annotations and a job summary                   |
| [test/fixtures](test/fixtures)                               | One small project per extractor, plus YAML and gettext  |

```console
$ npm run build
$ node dist/esm/cli.js --cwd examples/bangla-react
$ node dist/esm/cli.js --cwd examples/next-intl-bn
$ node examples/api.mjs
```

## Bangla and other scripts

Everything is Unicode-aware: files are read as UTF-8 and written back
without escaping (`"স্বাগতম"` stays readable in diffs), and the untranslated
check looks for words in any script (`\p{L}`), so values made only of
placeholders, numbers or URLs are not flagged. Plural checks use CLDR data from the JavaScript
runtime, so they are right for every language Node knows:

```text
bn  one, other                    ar  zero, one, two, few, many, other
hi  one, other                    ru  one, few, many, other
ja  other                         pl  one, few, many, other
```

For example, with next-intl the Bangla message
`{count, plural, =0 {...} other {...}}` is reported because Bangla uses
`one` as well:

```text
warning plural-forms (1)
  Home.unread in bn: {count, plural} lacks one (bn uses one, other)  messages/bn.json:4
```

## Contributing: add an extractor or a check

Both are plain objects in their own file, so a new library or rule is
usually one file plus a fixture and a test. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the setup.

### A new extractor

1. Create `src/extractors/<library>.ts`:

   ```ts
   import { createContext, scanCalls } from './common.js';
   import { maskJs } from './source.js';
   import type { Extractor } from './types.js';

   export const linguiExtractor: Extractor = {
     id: 'lingui',
     name: 'Lingui',
     extensions: ['js', 'jsx', 'ts', 'tsx'],
     packages: ['@lingui/core', '@lingui/react'],
     messageFormat: 'icu',
     extract(text, file) {
       const ctx = createContext('lingui', file, text);
       const { code, noComments } = maskJs(text); // comments and strings masked for call search
       scanCalls(ctx, noComments, code, ['i18n._', 't']); // records static keys, reports dynamic ones
       return ctx.result;
     },
   };
   ```

   `scanCalls` finds calls, reads the first argument as a key and records
   static keys or reports dynamic ones; `scanAttribute` reads JSX/HTML
   attributes such as `i18nKey="..."`; `splitComponent` separates
   `<template>` and `<script>` of single-file components.
2. Add it to `builtinExtractors` in `src/extractors/index.ts` and a row to
   the [Supported libraries](#supported-libraries) table.
3. Add a fixture project in `test/fixtures/<library>/` (a `package.json`
   with the dependency, two locale files, a source file that uses static,
   namespaced, dynamic and missing keys) and tests in
   `test/extractors.test.ts` and `test/checks.test.ts`.

Projects can also register their own extractor at runtime with
`registerExtractor()` when using the API.

### A new check

1. Add it to `src/checks/builtin.ts`:

   ```ts
   export const trailingSpace: Check = {
     id: 'trailing-space',
     description: 'A translation starts or ends with whitespace.',
     defaultSeverity: 'warning',
     run(ctx) {
       const issues: Issue[] = [];
       for (const locale of ctx.catalog.locales)
         for (const [key, e] of ctx.catalog.entries.get(locale)!)
           if (e.text !== e.text.trim() && !ctx.ignored(key))
             issues.push({ rule: 'trailing-space', severity: 'warning', key, locale, file: e.file, line: e.line, message: `${key} in ${locale} has surrounding whitespace` });
       return issues;
     },
   };
   ```

   The context gives you the catalog (every entry with file and line), the
   base entries, used and dynamic keys, the message format and helpers such
   as `isUsed()`, `resolves()` and the ignore lists.
2. Add it to `builtinChecks`, a row to the [Rules](#rules) table, and a test
   that triggers it and one that shows a clean case does not.

Issues labelled **good first issue** are a good start: new extractors
(Lingui, svelte-i18n, Transloco, i18n-js), new checks and more fixture cases
are usually self-contained.

## Roadmap

- More extractors: Lingui, svelte-i18n, Angular Transloco and `$localize`,
  i18n-js, Rails-style `I18n.t` in ERB
- `fix` for `.po` files and comment-preserving YAML writes
- A `--watch` mode and a cache for large monorepos
- Monorepo mode: one run for every workspace package
- Machine-translation-free "suggest" output: list untranslated keys as a CSV
  or XLIFF for translators
- An ESLint plugin that reuses the extractors

## Limitations

- Extraction is text-based, not a full parse. Unusual call shapes (keys built
  in another function, re-exported or renamed `t` functions, a destructured
  translator from a custom hook in next-intl) are not followed; add the
  function names with `functions`, or mark such keys with `ignoreUnused`.
- For i18next, the namespace of a file comes from its first
  `useTranslation()`, `withTranslation()` or `getFixedT()` call. Components
  that switch namespaces mid-file should use `t('ns:key')` or the `ns`
  option.
- The YAML reader is a subset: anchors, aliases, tags and flow mappings are
  reported as parse errors. `fix` rewrites YAML without comments.
- `.po` support is read-only and keys are `msgid`s; only singular
  `msgstr[0]` is compared for placeholders.
- i18next context variants (`key_male`) are not linked to their base key, and
  vue-i18n pipe plurals (`a | b | c`) are not checked for the number of
  branches.

## License

[MIT](LICENSE) © 2026 Saizul Amin
