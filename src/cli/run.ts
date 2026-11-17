import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type AnalyzeOptions, analyze } from '../analyze.js';
import { allChecks } from '../checks/index.js';
import type { Severity } from '../checks/types.js';
import { ConfigError, type FillMode, type I18nCheckConfig, loadConfig, type RuleSetting } from '../config.js';
import { builtinExtractors } from '../extractors/index.js';
import { applyFixes, planFixes } from '../fix.js';
import { CatalogError } from '../locales/catalog.js';
import { colors, counts, type Format, formatResult, plural } from '../report/index.js';
import { VERSION } from '../version.js';

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd?: string;
  env?: Record<string, string | undefined>;
  isTTY?: boolean;
}

class UsageError extends Error {}

const HELP = `i18n-check ${VERSION}
Find missing, unused and inconsistent translation keys.

Usage:
  i18n-check [check] [options]     Report problems (default command)
  i18n-check fix [options]         Sort keys, add missing keys, remove unused ones
  i18n-check extract [options]     List the keys found in the source code

Locales and sources:
  --locales <pattern>      Locale files, e.g. "locales/{locale}/{namespace}.json" (repeatable)
  --base <locale>          Base locale (default: en, else the locale with most keys)
  --only-locales <list>    Comma-separated locales to check
  --src <glob>             Source files to scan (repeatable; default: all JS/TS/Vue/Svelte/HTML)
  --exclude <glob>         Source files to skip (repeatable)
  --extractor <id>         i18next, vue-i18n, next-intl, react-intl, ngx-translate, generic (repeatable)
  --functions <list>       Translate function names, e.g. "t,i18n.t,__"
  --no-source              Do not scan sources (no unused/undefined checks)

Output:
  --format <f>             pretty (default), json, markdown or github
  --output <file>          Also write the report to a file (e.g. $GITHUB_STEP_SUMMARY)
  --min-severity <s>       Hide less severe issues in pretty output: error, warning or info
  --fail-on <s>            Exit 1 at this severity: error (default), warning, info or none
  --rule <id=severity>     Override a rule: error, warning, info or off (repeatable)
  --only <list>            Run only these rules
  --list-rules             Show the rules
  --list-extractors        Show the extractors

Fix:
  --add-missing            Add base keys missing in other locales
  --fill <mode>            Value for added keys: base (default), empty or key
  --remove-unused          Remove keys that the code does not use
  --remove-extra           Remove keys that the base locale does not have
  --sort / --no-sort       Sort keys (default: on)
  --dry-run                Show what would change without writing
  (fix without action flags = --add-missing --sort)

General:
  --cwd <dir>              Project directory
  --config <file>          Config file (default: i18n-check.config.json)
  --no-color               Disable colors (NO_COLOR is respected too)
  -h, --help               Show help
  -v, --version            Show the version

Exit codes: 0 no problems at --fail-on, 1 problems found, 2 usage or configuration error.
`;

const OPTIONS = {
  cwd: { type: 'string' },
  config: { type: 'string' },
  locales: { type: 'string', multiple: true },
  base: { type: 'string' },
  'only-locales': { type: 'string' },
  src: { type: 'string', multiple: true },
  exclude: { type: 'string', multiple: true },
  extractor: { type: 'string', multiple: true },
  functions: { type: 'string' },
  'no-source': { type: 'boolean' },
  format: { type: 'string' },
  output: { type: 'string' },
  'min-severity': { type: 'string' },
  'fail-on': { type: 'string' },
  rule: { type: 'string', multiple: true },
  only: { type: 'string' },
  'list-rules': { type: 'boolean' },
  'list-extractors': { type: 'boolean' },
  'add-missing': { type: 'boolean' },
  fill: { type: 'string' },
  'remove-unused': { type: 'boolean' },
  'remove-extra': { type: 'boolean' },
  sort: { type: 'boolean' },
  'no-sort': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

const COMMANDS = new Set(['check', 'fix', 'extract']);
const SEVERITIES = ['error', 'warning', 'info'];

const list = (v: string | undefined) =>
  v
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Runs the CLI and resolves to the exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  const env = io.env ?? process.env;
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    io.stderr(`i18n-check: ${(err as Error).message}\nRun "i18n-check --help" for usage.\n`);
    return 2;
  }
  const v = parsed.values;
  if (v.help) {
    io.stdout(HELP);
    return 0;
  }
  if (v.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  const c = colors(!v['no-color'] && env.NO_COLOR === undefined && io.isTTY === true);
  if (v['list-rules']) {
    for (const check of allChecks())
      io.stdout(`${check.id.padEnd(22)} ${String(check.defaultSeverity).padEnd(8)} ${check.description}\n`);
    return 0;
  }
  if (v['list-extractors']) {
    for (const e of builtinExtractors)
      io.stdout(`${e.id.padEnd(15)} ${e.name.padEnd(26)} ${e.extensions.join(', ')}\n`);
    return 0;
  }
  const [command = 'check', ...rest] = parsed.positionals;
  if (!COMMANDS.has(command) || rest.length > 0) {
    io.stderr(
      `i18n-check: unknown command "${parsed.positionals.join(' ')}"\nRun "i18n-check --help" for usage.\n`,
    );
    return 2;
  }

  const baseCwd = io.cwd ?? process.cwd();
  const cwd = v.cwd ? (isAbsolute(v.cwd) ? v.cwd : join(baseCwd, v.cwd)) : baseCwd;

  try {
    const format = (v.format ?? 'pretty') as Format;
    if (!['pretty', 'json', 'markdown', 'github'].includes(format))
      throw new UsageError(`--format must be pretty, json, markdown or github (got "${v.format}")`);
    const failOn = v['fail-on'] ?? 'error';
    if (![...SEVERITIES, 'none'].includes(failOn))
      throw new UsageError(`--fail-on must be error, warning, info or none (got "${failOn}")`);
    const minSeverity = v['min-severity'] as Severity | undefined;
    if (minSeverity && !SEVERITIES.includes(minSeverity))
      throw new UsageError(`--min-severity must be error, warning or info (got "${minSeverity}")`);

    const { config } = loadConfig(cwd, v.config);
    const options = mergeOptions(config, v);
    options.cwd = cwd;

    if (command === 'extract') {
      const result = analyze({ ...options, only: ['undefined-key'] });
      const keys = [...result.context.used.keys()].sort();
      if (format === 'json') {
        io.stdout(
          `${JSON.stringify({ keys: Object.fromEntries([...result.context.used].sort(([a], [b]) => (a < b ? -1 : 1))), dynamic: result.context.dynamic }, null, 2)}\n`,
        );
      } else {
        for (const k of keys) io.stdout(`${k}\n`);
        io.stderr(
          `${plural(keys.length, 'key')}, ${plural(result.context.dynamic.length, 'dynamic key')} in ${plural(result.usage?.files.length ?? 0, 'file')}\n`,
        );
      }
      return 0;
    }

    if (command === 'fix') {
      const result = analyze(options);
      const anyAction = v['add-missing'] || v['remove-unused'] || v['remove-extra'] || v.sort;
      const fill = (v.fill ?? config.fix?.fill ?? 'base') as FillMode;
      if (!['base', 'empty', 'key'].includes(fill))
        throw new UsageError(`--fill must be base, empty or key (got "${fill}")`);
      const sort = v['no-sort'] ? false : (v.sort ?? config.fix?.sort ?? true);
      const changes = planFixes(
        result,
        {
          addMissing: anyAction ? v['add-missing'] === true : true,
          removeUnused: v['remove-unused'] === true,
          removeExtra: v['remove-extra'] === true,
          sort,
          fill,
        },
        cwd,
      );
      if (v['remove-unused'] && (!result.usage || result.usage.files.length === 0))
        io.stderr('i18n-check: --remove-unused needs source files; nothing was removed\n');
      const dry = v['dry-run'] === true;
      if (!dry) applyFixes(changes, cwd);
      let added = 0;
      let removed = 0;
      for (const ch of changes) {
        added += ch.added.length;
        removed += ch.removed.length;
        const verb =
          ch.skipped && ch.content === undefined
            ? c.yellow('skip')
            : ch.created
              ? c.green('create')
              : c.cyan('update');
        const parts = [
          ch.added.length > 0 ? `+${ch.added.length}` : '',
          ch.removed.length > 0 ? `-${ch.removed.length}` : '',
          ch.skipped ? `(${ch.skipped})` : '',
        ].filter(Boolean);
        io.stdout(
          `${verb.padEnd(6)} ${ch.file}${parts.length > 0 ? `  ${parts.join(' ')}` : '  (sorted)'}\n`,
        );
        if (dry) {
          for (const k of ch.added.slice(0, 50)) io.stdout(c.green(`         + ${k}\n`));
          for (const k of ch.removed.slice(0, 50)) io.stdout(c.red(`         - ${k}\n`));
        }
      }
      const written = changes.filter((ch) => ch.content !== undefined).length;
      io.stdout(
        `${dry ? 'Dry run: would change' : 'Changed'} ${plural(written, 'file')}: ${plural(added, 'key')} added, ${removed} removed\n`,
      );
      return 0;
    }

    const result = analyze(options);
    const text = formatResult(result, format, c, minSeverity);
    io.stdout(text);
    if (v.output) {
      const out = isAbsolute(v.output) ? v.output : join(cwd, v.output);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, format === 'pretty' ? formatResult(result, 'markdown', colors(false)) : text, {
        flag: 'a',
      });
    }
    const n = counts(result.issues);
    if (failOn === 'none') return 0;
    if (n.error > 0) return 1;
    if (failOn === 'warning' && n.warning > 0) return 1;
    if (failOn === 'info' && n.warning + n.info > 0) return 1;
    return 0;
  } catch (err) {
    if (err instanceof UsageError || err instanceof ConfigError || err instanceof CatalogError) {
      io.stderr(`i18n-check: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

/** CLI flags on top of the config file. */
export function mergeOptions(config: I18nCheckConfig, v: Values): AnalyzeOptions {
  const o: AnalyzeOptions = { ...config };
  if (v.locales) o.locales = v.locales;
  if (v.base) o.baseLocale = v.base;
  if (v['only-locales']) o.onlyLocales = list(v['only-locales'])!;
  if (v.src) o.src = v.src;
  if (v.exclude) o.exclude = [...(config.exclude ?? []), ...v.exclude];
  if (v.extractor) o.extractors = v.extractor.flatMap((x) => list(x) ?? []);
  if (v.functions) o.functions = list(v.functions)!;
  if (v['no-source']) o.noSource = true;
  if (v.only) o.only = list(v.only)!;
  if (v.rule) {
    const rules: Record<string, RuleSetting> = { ...(config.rules ?? {}) };
    for (const r of v.rule) {
      const m = /^([a-z0-9-]+)=(error|warning|info|off)$/.exec(r);
      if (!m) throw new UsageError(`--rule must look like "unused-key=off" (got "${r}")`);
      rules[m[1]!] = m[2] as RuleSetting;
    }
    o.rules = rules;
  }
  return o;
}
