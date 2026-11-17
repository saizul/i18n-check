# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's
private vulnerability reporting ("Report a vulnerability" under the
repository's **Security** tab). You will get an answer within a week.

## Scope

i18n-check reads files from the project directory and, with `fix` or
`--output`, writes files. It never executes project code and makes no
network requests. Reports in these areas are welcome:

- **Writing outside the project.** `fix` must only write locale files that
  match the configured patterns inside the project, and `--output` only the
  given path.
- **Resource use.** Input (a locale file, a source file, a pattern) that makes
  a parser, the tokenizer or a regular expression take far more than linear
  time, or exhaust memory.
- **Output injection.** Markdown output escapes table syntax and GitHub
  annotations escape workflow command characters. Please report any way to
  inject other workflow commands through a key or a translation.

Translation files may contain text from many contributors. Treat the reports
as data: do not render them as HTML without escaping.
