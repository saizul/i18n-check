# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-17

### Added

- Locale files in JSON (nested or flat, with duplicate key detection), a
  built-in YAML subset (block scalars, Rails roots) and gettext `.po`
  (contexts, plurals, fuzzy entries).
- Layout detection for common folders (`public/locales/{locale}/{namespace}.json`,
  `messages/{locale}.json`, `src/assets/i18n/{locale}.json`, ...) and custom
  patterns with `{locale}`, `{namespace}`, `{ext}` and globs.
- Extractors for i18next / react-i18next, vue-i18n, next-intl, react-intl /
  FormatJS, Angular ngx-translate and plain `t()` functions, with namespaces,
  key prefixes, plural usage and dynamic keys; detection from package.json.
- Rules `parse-error`, `duplicate-key`, `missing-key`, `undefined-key`,
  `placeholder-mismatch`, `icu-syntax`, `plural-forms` (CLDR categories via
  `Intl.PluralRules`), `empty-value`, `extra-key`, `unused-key`,
  `untranslated` and `dynamic-key`, with configurable severities.
- Placeholder comparison for ICU, i18next, vue-i18n and printf styles.
- Reports: pretty with a coverage table, JSON, Markdown and GitHub Actions
  annotations; `--fail-on`, `--min-severity`, `--output`.
- `fix` command: add missing keys (base text, empty or key), remove unused or
  extra keys, sort, `--dry-run`; JSON style and Rails YAML roots preserved.
- `extract` command to list used keys.
- `i18n-check.config.json`, a programmatic API, `registerExtractor()` and
  `registerCheck()`.
- Bangla examples for react-i18next and next-intl.
- ESM and CommonJS builds with type declarations; no runtime dependencies.

[Unreleased]: https://github.com/saizul/i18n-check/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/saizul/i18n-check/releases/tag/v0.1.0
