import type { MessageFormat } from '../config.js';
import type { UsageScan } from '../extractors/index.js';
import type { DynamicKey, UsedKey } from '../extractors/types.js';
import type { Catalog, Entry } from '../locales/catalog.js';

export type Severity = 'error' | 'warning' | 'info';

/** One problem found by a check. */
export interface Issue {
  rule: string;
  severity: Severity;
  message: string;
  key?: string;
  locale?: string;
  file?: string;
  line?: number;
  column?: number;
}

/** Everything a check can look at. Built once per run. */
export interface CheckContext {
  catalog: Catalog;
  /** Source usage, when sources were scanned. */
  usage?: UsageScan;
  /** Used keys, qualified like catalog keys (`ns:key` in namespaced layouts). */
  used: Map<string, UsedKey[]>;
  /** Static prefixes of dynamic keys, qualified. */
  dynamicPrefixes: string[];
  dynamic: DynamicKey[];
  messageFormat: MessageFormat;
  /** i18next-style plural suffixes are in use. */
  pluralSuffixes: boolean;
  base: Map<string, Entry>;
  /** True when the key matches `ignoreKeys`. */
  ignored(key: string): boolean;
  ignoredUnused(key: string): boolean;
  ignoredUntranslated(key: string): boolean;
  /** Whether a catalog key is used in code, directly, by plural form or by a dynamic prefix. */
  isUsed(key: string): boolean;
  /** Whether a used key resolves to an entry of the locale, directly or by plural forms. */
  resolves(key: string, locale: string): boolean;
}

/**
 * A check. It returns issues with `severity` set to its default; the runner
 * applies the configured severity and drops issues of disabled rules.
 */
export interface Check {
  /** Stable kebab-case ID used in `rules` and `--rule`. */
  id: string;
  /** One sentence for `--list-rules` and the README. */
  description: string;
  defaultSeverity: Severity | 'off';
  /** Needs a source scan; skipped with `--no-source`. */
  needsUsage?: boolean;
  run(ctx: CheckContext): Issue[];
}
