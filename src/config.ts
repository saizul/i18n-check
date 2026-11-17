import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type RuleSetting = 'error' | 'warning' | 'info' | 'off';
export type MessageFormat = 'auto' | 'icu' | 'i18next' | 'vue' | 'printf';
export type FillMode = 'base' | 'empty' | 'key';

/** Contents of `i18n-check.config.json`. Every field is optional. */
export interface I18nCheckConfig {
  /**
   * Where the locale files are: one or more path patterns with `{locale}`
   * and optionally `{namespace}`, e.g. `public/locales/{locale}/{namespace}.json`.
   * Default: detected from common layouts.
   */
  locales?: string | string[];
  /** The source locale other locales are compared to. Default `en`, else the one with most keys. */
  baseLocale?: string;
  /** Only check these locales (the base locale is always included). */
  onlyLocales?: string[];
  /** Source globs to scan for used keys. */
  src?: string[];
  /** Globs to skip when scanning sources. */
  exclude?: string[];
  /** Extractor IDs. Default: detected from package.json dependencies. */
  extractors?: string[];
  /** Function names the `generic` and `i18next` extractors treat as translate calls. */
  functions?: string[];
  /** Namespace used for keys without one, in namespaced layouts. */
  defaultNamespace?: string;
  /** Separator between namespace and key, i18next style. Default `:`. */
  namespaceSeparator?: string;
  /** Separator between nested key segments. Default `.`. */
  keySeparator?: string;
  /** How placeholders are written. Default `auto` (based on the extractors). */
  messageFormat?: MessageFormat;
  /** Severity per rule ID, or `off`. */
  rules?: Record<string, RuleSetting>;
  /** Keys ignored by every rule. `*` matches any characters. */
  ignoreKeys?: string[];
  /** Keys never reported as unused (e.g. used from the server or a CMS). */
  ignoreUnused?: string[];
  /** Keys whose identical-to-base value is fine (brand names, "OK"). */
  ignoreUntranslated?: string[];
  /** Treat keys that start with the static part of a dynamic key as used. Default `true`. */
  dynamicPrefixAsUsed?: boolean;
  fix?: {
    /** Value for added keys: the base text, an empty string, or the key itself. Default `base`. */
    fill?: FillMode;
    /** Sort keys when writing. Default `true` for `fix`. */
    sort?: boolean;
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export const CONFIG_FILE = 'i18n-check.config.json';

const STRING_ARRAYS = [
  'onlyLocales',
  'src',
  'exclude',
  'extractors',
  'functions',
  'ignoreKeys',
  'ignoreUnused',
  'ignoreUntranslated',
];
const STRINGS = ['baseLocale', 'defaultNamespace', 'namespaceSeparator', 'keySeparator'];
const KNOWN = new Set([
  '$schema',
  'locales',
  'messageFormat',
  'rules',
  'dynamicPrefixAsUsed',
  'fix',
  ...STRING_ARRAYS,
  ...STRINGS,
]);

export function loadConfig(cwd: string, explicit?: string): { config: I18nCheckConfig; file?: string } {
  const file = explicit ?? (existsSync(join(cwd, CONFIG_FILE)) ? CONFIG_FILE : undefined);
  if (!file) return { config: {} };
  const path = isAbsolute(file) ? file : join(cwd, file);
  if (!existsSync(path)) throw new ConfigError(`Config file not found: ${file}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  return { config: validateConfig(data, file), file };
}

const isStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function validateConfig(data: unknown, name = 'config'): I18nCheckConfig {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new ConfigError(`${name} must be a JSON object`);
  const c = data as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of Object.keys(c)) if (!KNOWN.has(k)) problems.push(`unknown option "${k}"`);
  for (const k of STRING_ARRAYS)
    if (c[k] !== undefined && !isStrings(c[k])) problems.push(`"${k}" must be an array of strings`);
  for (const k of STRINGS)
    if (c[k] !== undefined && typeof c[k] !== 'string') problems.push(`"${k}" must be a string`);
  if (c.locales !== undefined && typeof c.locales !== 'string' && !isStrings(c.locales))
    problems.push('"locales" must be a string or an array of strings');
  if (
    c.messageFormat !== undefined &&
    !['auto', 'icu', 'i18next', 'vue', 'printf'].includes(c.messageFormat as string)
  )
    problems.push('"messageFormat" must be auto, icu, i18next, vue or printf');
  if (c.dynamicPrefixAsUsed !== undefined && typeof c.dynamicPrefixAsUsed !== 'boolean')
    problems.push('"dynamicPrefixAsUsed" must be true or false');
  if (c.rules !== undefined) {
    if (!c.rules || typeof c.rules !== 'object' || Array.isArray(c.rules))
      problems.push('"rules" must be an object');
    else
      for (const [k, v] of Object.entries(c.rules))
        if (!['error', 'warning', 'info', 'off'].includes(v as string))
          problems.push(`rule "${k}" must be error, warning, info or off`);
  }
  if (c.fix !== undefined) {
    const f = c.fix as Record<string, unknown>;
    if (!f || typeof f !== 'object' || Array.isArray(f)) problems.push('"fix" must be an object');
    else {
      for (const k of Object.keys(f))
        if (k !== 'fill' && k !== 'sort') problems.push(`unknown option "fix.${k}"`);
      if (f.fill !== undefined && !['base', 'empty', 'key'].includes(f.fill as string))
        problems.push('"fix.fill" must be base, empty or key');
      if (f.sort !== undefined && typeof f.sort !== 'boolean')
        problems.push('"fix.sort" must be true or false');
    }
  }
  if (problems.length > 0) throw new ConfigError(`${name}: ${problems.join('; ')}`);
  const { $schema: _s, ...rest } = c;
  return rest as I18nCheckConfig;
}
