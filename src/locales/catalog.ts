import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverLocaleFiles, type LocaleFileRef } from './discover.js';
import { detectJsonStyle, parseJsonTree } from './json.js';
import { parsePoTree } from './po.js';
import { type DuplicateKey, leaves, type ObjectNode, type ParseError } from './tree.js';
import { parseYamlTree } from './yaml.js';

export interface FileStyle {
  indent: string;
  finalNewline: boolean;
  /** Keys are written flat (`"a.b": "x"`) instead of nested. */
  flat: boolean;
  /** Rails-style YAML wraps everything in the locale code (`en:`). */
  rootKey?: string;
}

/** A parsed locale file. */
export interface LocaleFile {
  path: string;
  locale: string;
  namespace?: string;
  format: 'json' | 'yaml' | 'po';
  pattern: string;
  root: ObjectNode;
  duplicates: DuplicateKey[];
  errors: ParseError[];
  style: FileStyle;
}

/** One translation. */
export interface Entry {
  /** Qualified key: `namespace:key` in namespaced layouts, otherwise the key. */
  key: string;
  /** Key inside its file. */
  localKey: string;
  /** Path segments inside the file. */
  path: string[];
  /** The value as written (string, or number/boolean/array for non-text leaves). */
  value: unknown;
  /** The value as text, for comparisons and placeholder checks. */
  text: string;
  locale: string;
  namespace?: string;
  file: string;
  line: number;
  column: number;
}

export interface KeyConflict {
  locale: string;
  key: string;
  file: string;
  line: number;
  message: string;
}

export interface Catalog {
  files: LocaleFile[];
  locales: string[];
  baseLocale: string;
  namespaces: string[];
  hasNamespaces: boolean;
  namespaceSeparator: string;
  keySeparator: string;
  /** locale -> qualified key -> entry */
  entries: Map<string, Map<string, Entry>>;
  conflicts: KeyConflict[];
}

export interface LoadCatalogOptions {
  cwd: string;
  /** Patterns with `{locale}`, `{namespace}` and `{ext}`; default: detected. */
  patterns?: string[];
  baseLocale?: string;
  onlyLocales?: string[];
  keySeparator?: string;
  namespaceSeparator?: string;
}

export class CatalogError extends Error {
  override name = 'CatalogError';
}

/** Picks the base locale: configured, then `en`/`en-*`, then the locale with most keys. */
function pickBase(refs: LocaleFileRef[], configured?: string): string | undefined {
  const locales = [...new Set(refs.map((r) => r.locale))].sort();
  if (configured) return configured;
  return locales.find((l) => l === 'en') ?? locales.find((l) => /^en[-_]/.test(l));
}

export function parseLocaleFile(ref: LocaleFileRef, text: string, isBase: boolean): LocaleFile {
  const parsed =
    ref.format === 'json'
      ? parseJsonTree(text)
      : ref.format === 'yaml'
        ? parseYamlTree(text)
        : parsePoTree(text, isBase);
  let root = parsed.root;
  const style: FileStyle = { ...detectJsonStyle(text), flat: false };
  if (ref.format === 'yaml') style.indent = '  ';
  // Rails-style YAML: `en:` (or `pt-BR:`) wraps the whole file.
  if (ref.format === 'yaml' && root.children.size === 1) {
    const [name, child] = [...root.children][0]!;
    if (
      child.kind === 'object' &&
      name.replace('_', '-').toLowerCase() === ref.locale.replace('_', '-').toLowerCase()
    ) {
      root = child;
      style.rootKey = name;
    }
  }
  const hasObjects = [...root.children.values()].some((c) => c.kind === 'object');
  style.flat = ref.format === 'po' || (!hasObjects && [...root.children.keys()].some((k) => k.includes('.')));
  const file: LocaleFile = {
    path: ref.path,
    locale: ref.locale,
    format: ref.format,
    pattern: ref.pattern,
    root,
    duplicates: parsed.duplicates,
    errors: parsed.errors,
    style,
  };
  if (ref.namespace !== undefined) file.namespace = ref.namespace;
  return file;
}

/** Reads every locale file and indexes the translations. */
export function loadCatalog(options: LoadCatalogOptions): Catalog {
  const keySeparator = options.keySeparator ?? '.';
  const namespaceSeparator = options.namespaceSeparator ?? ':';
  let refs = discoverLocaleFiles(options.cwd, options.patterns);
  if (refs.length === 0) {
    throw new CatalogError(
      options.patterns?.length
        ? `No locale files match ${options.patterns.join(', ')}`
        : 'No locale files found. Set "locales" in i18n-check.config.json or pass --locales, e.g. --locales "locales/{locale}.json"',
    );
  }
  let base = pickBase(refs, options.baseLocale);
  if (options.onlyLocales && options.onlyLocales.length > 0) {
    const keep = new Set(options.onlyLocales);
    // The base locale is always needed; when it is unknown yet, keep every candidate.
    refs = refs.filter((r) => keep.has(r.locale) || r.locale === base || base === undefined);
  }
  const texts = new Map(refs.map((r) => [r.path, readFileSync(join(options.cwd, r.path), 'utf8')]));
  let files = refs.map((r) => parseLocaleFile(r, texts.get(r.path)!, r.locale === base));
  if (!base) {
    // The locale with most keys is most likely the source.
    const counts = new Map<string, number>();
    for (const f of files) counts.set(f.locale, (counts.get(f.locale) ?? 0) + [...leaves(f.root)].length);
    base = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    if (files.some((f) => f.format === 'po' && f.locale === base))
      files = refs.map((r) => parseLocaleFile(r, texts.get(r.path)!, r.locale === base));
  }
  if (options.onlyLocales && options.onlyLocales.length > 0) {
    const keep = new Set(options.onlyLocales);
    files = files.filter((f) => keep.has(f.locale) || f.locale === base);
  }
  const locales = [...new Set(files.map((f) => f.locale))].sort((a, b) =>
    a === base ? -1 : b === base ? 1 : a < b ? -1 : a > b ? 1 : 0,
  );
  if (!locales.includes(base)) {
    throw new CatalogError(`Base locale "${base}" has no files (found: ${locales.join(', ')})`);
  }
  const hasNamespaces = files.some((f) => f.namespace !== undefined);
  const namespaces = [
    ...new Set(files.map((f) => f.namespace).filter((n): n is string => n !== undefined)),
  ].sort();
  const entries = new Map<string, Map<string, Entry>>(locales.map((l) => [l, new Map()]));
  const conflicts: KeyConflict[] = [];

  for (const file of files) {
    const map = entries.get(file.locale)!;
    const leafKeys = new Set<string>();
    for (const { path, node } of leaves(file.root)) {
      const localKey = path.join(keySeparator);
      const key =
        file.namespace !== undefined ? `${file.namespace}${namespaceSeparator}${localKey}` : localKey;
      const text =
        typeof node.value === 'string'
          ? node.value
          : Array.isArray(node.value)
            ? node.value.join('\n')
            : String(node.value ?? '');
      if (map.has(key)) {
        const prev = map.get(key)!;
        conflicts.push({
          locale: file.locale,
          key,
          file: file.path,
          line: node.line,
          message: `"${localKey}" is defined twice (also at ${prev.file}:${prev.line}), e.g. once nested and once as a flat key`,
        });
      }
      const entry: Entry = {
        key,
        localKey,
        path,
        value: node.value,
        text,
        locale: file.locale,
        file: file.path,
        line: node.line,
        column: node.column,
      };
      if (file.namespace !== undefined) entry.namespace = file.namespace;
      map.set(key, entry);
      leafKeys.add(localKey);
    }
    // `a` as text and `a.b` as text cannot both exist for nested lookups.
    if (file.format === 'po') continue;
    for (const k of leafKeys) {
      const parts = k.split(keySeparator);
      for (let n = 1; n < parts.length; n++) {
        const parent = parts.slice(0, n).join(keySeparator);
        if (leafKeys.has(parent)) {
          const e = map.get(file.namespace !== undefined ? `${file.namespace}${namespaceSeparator}${k}` : k)!;
          conflicts.push({
            locale: file.locale,
            key: e.key,
            file: file.path,
            line: e.line,
            message: `"${k}" is nested under "${parent}", which is already a text value`,
          });
        }
      }
    }
  }
  return {
    files,
    locales,
    baseLocale: base,
    namespaces,
    hasNamespaces,
    namespaceSeparator,
    keySeparator,
    entries,
    conflicts,
  };
}
