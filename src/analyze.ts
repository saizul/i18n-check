import { buildContext, runChecks, unknownRules } from './checks/index.js';
import type { CheckContext, Issue } from './checks/types.js';
import { ConfigError, type I18nCheckConfig, type MessageFormat } from './config.js';
import {
  detectExtractors,
  extractorIds,
  getExtractor,
  scanUsage,
  type UsageScan,
} from './extractors/index.js';
import type { Extractor } from './extractors/types.js';
import { type Catalog, loadCatalog } from './locales/catalog.js';

export interface AnalyzeOptions extends I18nCheckConfig {
  cwd?: string;
  /** Skip scanning source code (no unused, undefined or dynamic key checks). */
  noSource?: boolean;
  /** Only run these rule IDs. */
  only?: string[];
}

export interface LocaleStats {
  locale: string;
  /** Keys in this locale. */
  keys: number;
  /** Base keys present in this locale. */
  translated: number;
  missing: number;
  empty: number;
  /** Share of base keys that are present and not empty, 0-100. */
  coverage: number;
}

export interface AnalyzeResult {
  catalog: Catalog;
  usage?: UsageScan;
  extractors: Extractor[];
  messageFormat: MessageFormat;
  issues: Issue[];
  stats: LocaleStats[];
  context: CheckContext;
}

/** Resolves extractor IDs from the config, or detects them from package.json. */
export function resolveExtractors(cwd: string, ids?: string[]): Extractor[] {
  if (!ids || ids.length === 0) return detectExtractors(cwd);
  return ids.map((id) => {
    const e = getExtractor(id);
    if (!e) throw new ConfigError(`Unknown extractor "${id}" (available: ${extractorIds().join(', ')})`);
    return e;
  });
}

export function resolveMessageFormat(
  configured: MessageFormat | undefined,
  extractors: Extractor[],
): MessageFormat {
  if (configured && configured !== 'auto') return configured;
  const formats = new Set(extractors.map((e) => e.messageFormat));
  return formats.size === 1 ? [...formats][0]! : 'auto';
}

/** Loads the locales, scans the sources and runs every check. */
export function analyze(options: AnalyzeOptions = {}): AnalyzeResult {
  const cwd = options.cwd ?? process.cwd();
  const unknown = unknownRules(options.rules);
  if (unknown.length > 0)
    throw new ConfigError(`Unknown rule${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
  const catalog = loadCatalog({
    cwd,
    patterns: typeof options.locales === 'string' ? [options.locales] : options.locales,
    baseLocale: options.baseLocale,
    onlyLocales: options.onlyLocales,
    keySeparator: options.keySeparator,
    namespaceSeparator: options.namespaceSeparator,
  });
  const extractors = resolveExtractors(cwd, options.extractors);
  const messageFormat = resolveMessageFormat(options.messageFormat, extractors);
  const usage = options.noSource
    ? undefined
    : scanUsage(cwd, extractors, {
        src: options.src,
        exclude: options.exclude,
        functions: options.functions,
        namespaceSeparator: catalog.namespaceSeparator,
        keySeparator: catalog.keySeparator,
      });
  const context = buildContext(catalog, usage, {
    messageFormat,
    pluralSuffixes: extractors.some((e) => e.pluralSuffixes) || messageFormat === 'i18next',
    defaultNamespace: options.defaultNamespace,
    ignoreKeys: options.ignoreKeys,
    ignoreUnused: options.ignoreUnused,
    ignoreUntranslated: options.ignoreUntranslated,
    dynamicPrefixAsUsed: options.dynamicPrefixAsUsed,
  });
  const issues = runChecks(context, { rules: options.rules, only: options.only });
  const result: AnalyzeResult = {
    catalog,
    extractors,
    messageFormat,
    issues,
    stats: computeStats(catalog, context),
    context,
  };
  if (usage) result.usage = usage;
  return result;
}

export function computeStats(catalog: Catalog, ctx: CheckContext): LocaleStats[] {
  const baseKeys = [...ctx.base.keys()].filter((k) => !ctx.ignored(k));
  return catalog.locales.map((locale) => {
    const map = catalog.entries.get(locale)!;
    let translated = 0;
    let empty = 0;
    for (const k of baseKeys) {
      const e = map.get(k);
      if (!e) continue;
      translated++;
      if (typeof e.value === 'string' && e.text.trim() === '') empty++;
    }
    const total = baseKeys.length;
    return {
      locale,
      keys: map.size,
      translated,
      missing: total - translated,
      empty,
      coverage: total === 0 ? 100 : Math.floor(((translated - empty) / total) * 1000) / 10,
    };
  });
}
