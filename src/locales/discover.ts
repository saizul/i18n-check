import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SKIP_DIRS } from '../util/glob.js';

/** A locale file found on disk, before parsing. */
export interface LocaleFileRef {
  /** Relative path with forward slashes. */
  path: string;
  locale: string;
  namespace?: string;
  format: 'json' | 'yaml' | 'po';
  /** The pattern that matched, e.g. `locales/{locale}/{namespace}.json`. */
  pattern: string;
}

/**
 * Common layouts, tried in order when no `locales` pattern is configured.
 * `{ext}` stands for json, yaml, yml or po.
 */
export const DEFAULT_LOCALE_PATTERNS = [
  'public/locales/{locale}/{namespace}.{ext}',
  'static/locales/{locale}/{namespace}.{ext}',
  'locales/{locale}/{namespace}.{ext}',
  'src/locales/{locale}/{namespace}.{ext}',
  'src/i18n/locales/{locale}/{namespace}.{ext}',
  'app/i18n/locales/{locale}/{namespace}.{ext}',
  'locale/{locale}/LC_MESSAGES/{namespace}.po',
  'locales/{locale}.{ext}',
  'src/locales/{locale}.{ext}',
  'messages/{locale}.{ext}',
  'src/messages/{locale}.{ext}',
  'src/i18n/{locale}.{ext}',
  'src/i18n/locales/{locale}.{ext}',
  'i18n/{locale}.{ext}',
  'lang/{locale}.{ext}',
  'src/lang/{locale}.{ext}',
  'translations/{locale}.{ext}',
  'src/assets/i18n/{locale}.{ext}',
  'assets/i18n/{locale}.{ext}',
  'public/i18n/{locale}.{ext}',
  'config/locales/{locale}.{ext}',
  'po/{locale}.po',
];

// en, bn, bn-BD, pt_BR, zh-Hant-TW, es-419
const LOCALE_RE = '[a-z]{2,3}(?:[-_](?:[A-Z][a-z]{3}|[A-Za-z]{2}|\\d{3}))*';

/** Converts a pattern to a regular expression with named groups. */
export function patternToRegExp(pattern: string): RegExp {
  let re = '';
  const tokens = pattern.split(/(\{locale\}|\{namespace\}|\{ext\}|\*\*\/|\*\*|\*)/);
  for (const t of tokens) {
    if (t === '{locale}') re += `(?<locale>${LOCALE_RE})`;
    else if (t === '{namespace}') re += '(?<namespace>[^/]+?|[^/].*?)';
    else if (t === '{ext}') re += '(?<ext>json|ya?ml|po)';
    else if (t === '**/') re += '(?:.*/)?';
    else if (t === '**') re += '.*';
    else if (t === '*') re += '[^/]*';
    else re += t.replace(/[.+?^$()|[\]\\{}]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function listFiles(root: string, maxFiles = 50_000): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 12 || out.length >= maxFiles) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!DEFAULT_SKIP_DIRS.has(e.name)) walk(join(dir, e.name), rel, depth + 1);
      } else if (e.isFile() && /\.(json|ya?ml|po)$/.test(e.name)) out.push(rel);
    }
  };
  walk(root, '', 0);
  return out.sort();
}

function formatOf(path: string): LocaleFileRef['format'] {
  if (path.endsWith('.po')) return 'po';
  return /\.ya?ml$/.test(path) ? 'yaml' : 'json';
}

function match(files: string[], pattern: string): LocaleFileRef[] {
  const re = patternToRegExp(pattern);
  const out: LocaleFileRef[] = [];
  for (const path of files) {
    const m = re.exec(path);
    if (!m?.groups?.locale) continue;
    const ref: LocaleFileRef = { path, locale: m.groups.locale, format: formatOf(path), pattern };
    if (m.groups.namespace !== undefined) ref.namespace = m.groups.namespace;
    out.push(ref);
  }
  return out;
}

/**
 * Finds locale files. With patterns, every match of every pattern is used.
 * Without, the first default layout that matches files for at least two
 * locales wins (or, failing that, the first layout with any match).
 */
export function discoverLocaleFiles(cwd: string, patterns?: string[]): LocaleFileRef[] {
  const files = listFiles(cwd);
  if (patterns && patterns.length > 0) {
    const seen = new Set<string>();
    const out: LocaleFileRef[] = [];
    for (const p of patterns)
      for (const ref of match(files, p)) {
        if (seen.has(ref.path)) continue;
        seen.add(ref.path);
        out.push(ref);
      }
    return out;
  }
  let fallback: LocaleFileRef[] | undefined;
  for (const p of DEFAULT_LOCALE_PATTERNS) {
    const refs = match(files, p);
    if (refs.length === 0) continue;
    if (new Set(refs.map((r) => r.locale)).size >= 2) return refs;
    fallback ??= refs;
  }
  return fallback ?? [];
}

/** Builds the path of a locale file that does not exist yet, from a sibling's pattern. */
export function pathFor(pattern: string, locale: string, namespace: string | undefined, ext: string): string {
  return pattern
    .replace('{locale}', locale)
    .replace('{namespace}', namespace ?? 'translation')
    .replace('{ext}', ext);
}
