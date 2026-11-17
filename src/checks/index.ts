import type { MessageFormat, RuleSetting } from '../config.js';
import type { UsageScan } from '../extractors/index.js';
import type { UsedKey } from '../extractors/types.js';
import type { Catalog } from '../locales/catalog.js';
import { PLURAL_SUFFIXES, splitPluralKey } from '../message/placeholders.js';
import { builtinChecks } from './builtin.js';
import type { Check, CheckContext, Issue, Severity } from './types.js';

export interface ContextOptions {
  messageFormat: MessageFormat;
  pluralSuffixes: boolean;
  defaultNamespace?: string;
  ignoreKeys?: string[];
  ignoreUnused?: string[];
  ignoreUntranslated?: string[];
  dynamicPrefixAsUsed?: boolean;
}

/** `*` matches any characters, everything else is literal. */
export function keyMatcher(patterns: string[] = []): (key: string) => boolean {
  if (patterns.length === 0) return () => false;
  const res = patterns.map(
    (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`),
  );
  return (key) => res.some((r) => r.test(key));
}

/** The namespace for keys without one in a namespaced layout. */
export function defaultNamespaceOf(catalog: Catalog, configured?: string): string | undefined {
  if (!catalog.hasNamespaces) return undefined;
  if (configured) return configured;
  for (const n of ['translation', 'common', 'messages', 'default'])
    if (catalog.namespaces.includes(n)) return n;
  return catalog.namespaces[0];
}

/** Turns a used key into a catalog key. */
export function qualify(
  catalog: Catalog,
  key: string,
  namespace: string | undefined,
  defaultNs?: string,
): string {
  if (catalog.hasNamespaces) return `${namespace ?? defaultNs ?? ''}${catalog.namespaceSeparator}${key}`;
  return namespace ? `${namespace}${catalog.keySeparator}${key}` : key;
}

export function buildContext(
  catalog: Catalog,
  usage: UsageScan | undefined,
  options: ContextOptions,
): CheckContext {
  const base = catalog.entries.get(catalog.baseLocale)!;
  const defaultNs = defaultNamespaceOf(catalog, options.defaultNamespace);
  const used = new Map<string, UsedKey[]>();
  for (const k of usage?.keys ?? []) {
    const q = qualify(catalog, k.key, k.namespace, defaultNs);
    const list = used.get(q);
    if (list) list.push(k);
    else used.set(q, [k]);
  }
  // i18next nesting: "$t(other.key)" inside a value uses that key.
  const nested = new Set<string>();
  if (options.messageFormat === 'i18next' || options.messageFormat === 'auto') {
    for (const e of base.values()) {
      for (const m of e.text.matchAll(/\$t\(\s*([^,)\s]+)/g)) {
        const raw = m[1]!.replace(/^['"]|['"]$/g, '');
        const idx = raw.indexOf(catalog.namespaceSeparator);
        nested.add(
          idx > 0 && catalog.hasNamespaces
            ? raw
            : qualify(catalog, raw, catalog.hasNamespaces ? e.namespace : undefined, defaultNs),
        );
      }
    }
  }
  // vue-i18n linked messages: "@:other.key"
  if (options.messageFormat === 'vue' || options.messageFormat === 'auto') {
    for (const e of base.values())
      for (const m of e.text.matchAll(/@(?:\.[a-z]+)?:(?:\(([^)]+)\)|([\w.-]+))/g)) nested.add(m[1] ?? m[2]!);
  }
  const dynamic = usage?.dynamic ?? [];
  const dynamicPrefixes =
    options.dynamicPrefixAsUsed === false
      ? []
      : dynamic.filter((d) => d.prefix !== '').map((d) => qualify(catalog, d.prefix, d.namespace, defaultNs));
  const usedSet = new Set([...used.keys(), ...nested]);
  const sep = catalog.keySeparator;

  const isUsed = (key: string): boolean => {
    if (usedSet.has(key)) return true;
    const p = options.pluralSuffixes ? splitPluralKey(key) : undefined;
    if (p && usedSet.has(p.stem)) return true;
    if (dynamicPrefixes.some((prefix) => key.startsWith(prefix))) return true;
    // t('errors', { returnObjects: true }) or $tm('list') uses everything below.
    for (let i = key.lastIndexOf(sep); i > 0; i = key.lastIndexOf(sep, i - 1))
      if (usedSet.has(key.slice(0, i))) return true;
    return false;
  };
  const parentsByLocale = new Map<string, Set<string>>();
  const parentsOf = (locale: string) => {
    let set = parentsByLocale.get(locale);
    if (!set) {
      set = new Set();
      for (const k of catalog.entries.get(locale)?.keys() ?? [])
        for (let i = k.lastIndexOf(sep); i > 0; i = k.lastIndexOf(sep, i - 1)) set.add(k.slice(0, i));
      parentsByLocale.set(locale, set);
    }
    return set;
  };
  const resolves = (key: string, locale: string): boolean => {
    const map = catalog.entries.get(locale);
    if (!map) return false;
    if (map.has(key)) return true;
    if (options.pluralSuffixes)
      for (const c of PLURAL_SUFFIXES)
        if (map.has(`${key}_${c}`) || map.has(`${key}_ordinal_${c}`)) return true;
    return parentsOf(locale).has(key);
  };

  const ctx: CheckContext = {
    catalog,
    used,
    dynamicPrefixes,
    dynamic,
    messageFormat: options.messageFormat,
    pluralSuffixes: options.pluralSuffixes,
    base,
    ignored: keyMatcher(options.ignoreKeys),
    ignoredUnused: keyMatcher(options.ignoreUnused),
    ignoredUntranslated: keyMatcher(options.ignoreUntranslated),
    isUsed,
    resolves,
  };
  if (usage) ctx.usage = usage;
  return ctx;
}

const checkRegistry = new Map(builtinChecks.map((c) => [c.id, c]));

/** Adds a custom check (or replaces one with the same ID). */
export function registerCheck(check: Check): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(check.id))
    throw new TypeError(`Check IDs must be kebab-case: "${check.id}"`);
  checkRegistry.set(check.id, check);
}

export function allChecks(): Check[] {
  return [...checkRegistry.values()];
}

export interface RunChecksOptions {
  rules?: Record<string, RuleSetting>;
  /** Only run these rule IDs. */
  only?: string[];
}

/** Runs every enabled check and returns issues with their final severity, grouped by check. */
export function runChecks(ctx: CheckContext, options: RunChecksOptions = {}): Issue[] {
  const issues: Issue[] = [];
  for (const check of checkRegistry.values()) {
    const setting = options.rules?.[check.id] ?? check.defaultSeverity;
    if (setting === 'off') continue;
    if (options.only && options.only.length > 0 && !options.only.includes(check.id)) continue;
    if (check.needsUsage && !ctx.usage) continue;
    const found = check.run(ctx).map((issue) => ({ ...issue, severity: setting as Severity }));
    found.sort(
      (a, b) =>
        (a.locale ?? '').localeCompare(b.locale ?? '') ||
        (a.file ?? '').localeCompare(b.file ?? '') ||
        (a.line ?? 0) - (b.line ?? 0) ||
        (a.key ?? '').localeCompare(b.key ?? ''),
    );
    issues.push(...found);
  }
  return issues;
}

/** Unknown rule IDs in a config, for a helpful error. */
export function unknownRules(rules: Record<string, unknown> = {}): string[] {
  return Object.keys(rules).filter((r) => !checkRegistry.has(r));
}
