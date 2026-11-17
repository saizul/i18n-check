import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findFiles } from '../util/glob.js';
import { angularExtractor } from './angular.js';
import { genericExtractor } from './generic.js';
import { i18nextExtractor } from './i18next.js';
import { nextIntlExtractor } from './next-intl.js';
import { reactIntlExtractor } from './react-intl.js';
import type { DynamicKey, ExtractOptions, Extractor, UsedKey } from './types.js';
import { vueI18nExtractor } from './vue.js';

/** Built-in extractors, in detection order. */
export const builtinExtractors: Extractor[] = [
  i18nextExtractor,
  vueI18nExtractor,
  nextIntlExtractor,
  reactIntlExtractor,
  angularExtractor,
  genericExtractor,
];

const registry = new Map(builtinExtractors.map((e) => [e.id, e]));

/** Adds a custom extractor (or replaces one with the same ID). */
export function registerExtractor(extractor: Extractor): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(extractor.id))
    throw new TypeError(`Extractor IDs must be kebab-case: "${extractor.id}"`);
  registry.set(extractor.id, extractor);
}

export function getExtractor(id: string): Extractor | undefined {
  return registry.get(id);
}

export function extractorIds(): string[] {
  return [...registry.keys()];
}

/** Picks extractors from the dependencies in package.json; `generic` when none match. */
export function detectExtractors(cwd: string): Extractor[] {
  const deps = new Set<string>();
  const path = join(cwd, 'package.json');
  if (existsSync(path)) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies'])
        for (const name of Object.keys(pkg[field] ?? {})) deps.add(name);
    } catch {
      // An unreadable package.json just means no detection.
    }
  }
  const found = [...registry.values()].filter((e) => e.packages.some((p) => deps.has(p)));
  return found.length > 0 ? found : [genericExtractor];
}

export const DEFAULT_SOURCE_GLOBS = ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,html,astro}'];
export const DEFAULT_SOURCE_EXCLUDE = [
  '**/*.d.ts',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/*.min.js',
  '**/*.stories.*',
  'i18n-check.config.*',
];

export interface UsageScan {
  keys: UsedKey[];
  dynamic: DynamicKey[];
  files: string[];
  extractors: string[];
}

/** Reads the source files and runs each extractor on the files it understands. */
export function scanUsage(
  cwd: string,
  extractors: Extractor[],
  options: ExtractOptions & { src?: string[]; exclude?: string[] },
): UsageScan {
  const files = findFiles(cwd, options.src && options.src.length > 0 ? options.src : DEFAULT_SOURCE_GLOBS, {
    ignore: [...DEFAULT_SOURCE_EXCLUDE, ...(options.exclude ?? [])],
  });
  const keys: UsedKey[] = [];
  const dynamic: DynamicKey[] = [];
  const scanned: string[] = [];
  for (const file of files) {
    const ext = file.slice(file.lastIndexOf('.') + 1);
    const applicable = extractors.filter((e) => e.extensions.includes(ext));
    if (applicable.length === 0) continue;
    let text: string;
    try {
      text = readFileSync(join(cwd, file), 'utf8');
    } catch {
      continue;
    }
    scanned.push(file);
    const seen = new Set<string>();
    for (const e of applicable) {
      const r = e.extract(text, file, { ...options, functions: options.functions ?? e.defaultFunctions });
      // Two extractors may find the same call; keep one.
      for (const k of r.keys) {
        const id = `${k.namespace ?? ''}\u0000${k.key}\u0000${k.line}\u0000${k.column}`;
        if (seen.has(id)) continue;
        seen.add(id);
        keys.push(k);
      }
      for (const d of r.dynamic) {
        const id = `dyn\u0000${d.line}\u0000${d.column}`;
        if (seen.has(id)) continue;
        seen.add(id);
        dynamic.push(d);
      }
    }
  }
  return { keys, dynamic, files: scanned, extractors: extractors.map((e) => e.id) };
}
