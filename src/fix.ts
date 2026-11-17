import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AnalyzeResult } from './analyze.js';
import type { FillMode } from './config.js';
import type { Entry, LocaleFile } from './locales/catalog.js';
import { pathFor } from './locales/discover.js';
import { stringifyJsonTree } from './locales/json.js';
import { deleteLeaf, objectNode, setLeaf, sortTree } from './locales/tree.js';
import { stringifyYamlTree } from './locales/yaml.js';
import { pluralCategories, splitPluralKey } from './message/placeholders.js';

export interface FixOptions {
  /** Sort keys in every file. */
  sort?: boolean;
  /** Add keys of the base locale that other locales lack. */
  addMissing?: boolean;
  /** Value for added keys. Default `base`. */
  fill?: FillMode;
  /** Remove keys that the code does not use, from every locale. */
  removeUnused?: boolean;
  /** Remove keys that only exist in non-base locales. */
  removeExtra?: boolean;
}

export interface FileChange {
  file: string;
  locale: string;
  created: boolean;
  added: string[];
  removed: string[];
  /** Set when the file could not be changed. */
  skipped?: string;
  /** New contents, when the file changes. */
  content?: string;
}

/** Computes the new contents of every affected file without writing anything. */
export function planFixes(result: AnalyzeResult, options: FixOptions, cwd: string): FileChange[] {
  const { catalog, context: ctx } = result;
  const sep = catalog.keySeparator;
  const changes = new Map<LocaleFile, FileChange>();
  const files = [...catalog.files];
  const change = (f: LocaleFile, created = false) => {
    let c = changes.get(f);
    if (!c) {
      c = { file: f.path, locale: f.locale, created, added: [], removed: [] };
      changes.set(f, c);
    }
    return c;
  };
  const pathIn = (file: LocaleFile, entry: Entry) =>
    file.style.flat ? [entry.localKey] : entry.path.length > 1 ? entry.path : entry.localKey.split(sep);

  // Keys that will be removed as unused are not added to other locales.
  const unused = new Set<string>();
  if (options.removeUnused && result.usage && result.usage.files.length > 0) {
    for (const key of ctx.base.keys()) {
      if (!ctx.ignored(key) && !ctx.ignoredUnused(key) && !ctx.isUsed(key)) unused.add(key);
    }
  }

  if (options.addMissing) {
    for (const locale of catalog.locales) {
      if (locale === catalog.baseLocale) continue;
      const map = catalog.entries.get(locale)!;
      for (const [key, base] of ctx.base) {
        if (map.has(key) || ctx.ignored(key) || unused.has(key)) continue;
        const p = ctx.pluralSuffixes ? splitPluralKey(key) : undefined;
        if (p && !pluralCategories(locale, p.ordinal ? 'ordinal' : 'cardinal').includes(p.category)) continue;
        let target = files.find((f) => f.locale === locale && f.namespace === base.namespace);
        if (!target) {
          const baseFile = catalog.files.find((f) => f.path === base.file)!;
          const ext = baseFile.path.slice(baseFile.path.lastIndexOf('.') + 1);
          // Swap the locale segment of the base file's path: locales/en/common.json -> locales/bn/common.json.
          const segment = new RegExp(
            `(^|/)${catalog.baseLocale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/.])`,
          );
          const path = segment.test(baseFile.path)
            ? baseFile.path.replace(segment, `$1${locale}`)
            : pathFor(baseFile.pattern, locale, base.namespace, ext);
          target = {
            path,
            locale,
            format: baseFile.format,
            pattern: baseFile.pattern,
            root: objectNode(),
            duplicates: [],
            errors: [],
            style: { ...baseFile.style, ...(baseFile.style.rootKey ? { rootKey: locale } : {}) },
          };
          if (base.namespace !== undefined) target.namespace = base.namespace;
          files.push(target);
          change(target, true);
        }
        const c = change(target);
        if (target.format === 'po') {
          c.skipped = 'writing .po files is not supported yet';
          continue;
        }
        if (target.errors.length > 0) {
          c.skipped = 'the file has syntax errors';
          continue;
        }
        const fill = options.fill ?? 'base';
        const value = fill === 'empty' ? '' : fill === 'key' ? base.localKey : base.value;
        if (setLeaf(target.root, pathIn(target, base), value)) c.added.push(key);
        else c.skipped = `cannot add ${key}: a text value is in the way`;
      }
    }
  }

  const remove = (entry: Entry) => {
    const file = files.find((f) => f.path === entry.file)!;
    const c = change(file);
    if (file.format === 'po') {
      c.skipped = 'writing .po files is not supported yet';
      return;
    }
    if (deleteLeaf(file.root, file.style.flat ? [entry.localKey] : entry.path)) c.removed.push(entry.key);
  };

  if (unused.size > 0) {
    for (const key of unused) {
      for (const locale of catalog.locales) {
        const e = catalog.entries.get(locale)!.get(key);
        if (e) remove(e);
      }
    }
  }

  if (options.removeExtra) {
    const stems = new Set([...ctx.base.keys()].map((k) => splitPluralKey(k)?.stem).filter(Boolean));
    for (const locale of catalog.locales) {
      if (locale === catalog.baseLocale) continue;
      for (const [key, e] of catalog.entries.get(locale)!) {
        if (ctx.base.has(key) || ctx.ignored(key)) continue;
        const p = ctx.pluralSuffixes ? splitPluralKey(key) : undefined;
        if (p && stems.has(p.stem)) continue;
        remove(e);
      }
    }
  }

  if (options.sort) for (const f of files) if (f.format !== 'po' && f.errors.length === 0) change(f);

  const out: FileChange[] = [];
  for (const [file, c] of changes) {
    if (c.skipped && c.added.length === 0 && c.removed.length === 0) {
      out.push(c);
      continue;
    }
    if (file.format === 'po' || file.errors.length > 0) continue;
    if (options.sort) sortTree(file.root);
    let root = file.root;
    if (file.style.rootKey) {
      root = objectNode();
      root.children.set(file.style.rootKey, file.root);
    }
    const content =
      file.format === 'yaml'
        ? stringifyYamlTree(root)
        : stringifyJsonTree(root, { indent: file.style.indent, finalNewline: file.style.finalNewline });
    const path = join(cwd, file.path);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (before === content) continue;
    c.content = content;
    out.push(c);
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Writes planned changes to disk. */
export function applyFixes(changes: FileChange[], cwd: string): void {
  for (const c of changes) {
    if (c.content === undefined) continue;
    const path = join(cwd, c.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, c.content);
  }
}
