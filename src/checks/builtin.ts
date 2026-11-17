import type { Entry } from '../locales/catalog.js';
import { parseIcu } from '../message/icu.js';
import { comparePlaceholders, pluralCategories, splitPluralKey } from '../message/placeholders.js';
import type { Check, CheckContext, Issue } from './types.js';

const quote = (s: string, max = 50) => {
  const one = s.replace(/\s+/g, ' ');
  return JSON.stringify(one.length > max ? `${one.slice(0, max - 1)}…` : one);
};

/** The file of a locale and namespace, to point annotations at. */
function fileFor(ctx: CheckContext, locale: string, namespace: string | undefined): string | undefined {
  return ctx.catalog.files.find((f) => f.locale === locale && f.namespace === namespace)?.path;
}

/** A plural variant the locale does not need (e.g. `_one` in Japanese) is not missing. */
function notNeeded(ctx: CheckContext, key: string, locale: string): boolean {
  if (!ctx.pluralSuffixes) return false;
  const p = splitPluralKey(key);
  if (!p) return false;
  return !pluralCategories(locale, p.ordinal ? 'ordinal' : 'cardinal').includes(p.category);
}

function language(locale: string): string {
  return locale.split(/[-_]/)[0]!.toLowerCase();
}

export const missingKey: Check = {
  id: 'missing-key',
  description: 'A key of the base locale is missing in another locale.',
  defaultSeverity: 'error',
  run(ctx) {
    const issues: Issue[] = [];
    for (const locale of ctx.catalog.locales) {
      if (locale === ctx.catalog.baseLocale) continue;
      const map = ctx.catalog.entries.get(locale)!;
      for (const [key, base] of ctx.base) {
        if (map.has(key) || ctx.ignored(key) || notNeeded(ctx, key, locale)) continue;
        const issue: Issue = {
          rule: 'missing-key',
          severity: 'error',
          key,
          locale,
          message: `${key} is missing in ${locale} (${ctx.catalog.baseLocale}: ${quote(base.text)})`,
        };
        const file = fileFor(ctx, locale, base.namespace);
        issue.file = file ?? base.file;
        if (!file) issue.line = base.line;
        issues.push(issue);
      }
    }
    return issues;
  },
};

export const extraKey: Check = {
  id: 'extra-key',
  description: 'A locale has a key that the base locale does not have (often a renamed or deleted key).',
  defaultSeverity: 'warning',
  run(ctx) {
    const issues: Issue[] = [];
    const baseStems = new Set<string>();
    for (const k of ctx.base.keys()) {
      const p = splitPluralKey(k);
      if (p) baseStems.add(p.stem);
    }
    for (const locale of ctx.catalog.locales) {
      if (locale === ctx.catalog.baseLocale) continue;
      for (const [key, e] of ctx.catalog.entries.get(locale)!) {
        if (ctx.base.has(key) || ctx.ignored(key)) continue;
        // Extra plural forms for a stem the base has are expected (Arabic needs six).
        const p = ctx.pluralSuffixes ? splitPluralKey(key) : undefined;
        if (p && baseStems.has(p.stem)) continue;
        issues.push({
          rule: 'extra-key',
          severity: 'warning',
          key,
          locale,
          file: e.file,
          line: e.line,
          message: `${key} exists in ${locale} but not in ${ctx.catalog.baseLocale}`,
        });
      }
    }
    return issues;
  },
};

export const unusedKey: Check = {
  id: 'unused-key',
  description: 'A key of the base locale is not used anywhere in the scanned source code.',
  defaultSeverity: 'warning',
  needsUsage: true,
  run(ctx) {
    if (!ctx.usage || ctx.usage.files.length === 0) return [];
    const issues: Issue[] = [];
    for (const [key, e] of ctx.base) {
      if (ctx.ignored(key) || ctx.ignoredUnused(key) || ctx.isUsed(key)) continue;
      issues.push({
        rule: 'unused-key',
        severity: 'warning',
        key,
        locale: e.locale,
        file: e.file,
        line: e.line,
        message: `${key} is not used in the code`,
      });
    }
    return issues;
  },
};

export const undefinedKey: Check = {
  id: 'undefined-key',
  description: 'Code uses a key that the base locale does not define.',
  defaultSeverity: 'error',
  needsUsage: true,
  run(ctx) {
    const issues: Issue[] = [];
    const base = ctx.catalog.baseLocale;
    for (const [key, uses] of ctx.used) {
      if (ctx.ignored(key) || ctx.resolves(key, base)) continue;
      const elsewhere = ctx.catalog.locales.filter((l) => l !== base && ctx.resolves(key, l));
      const where = elsewhere.length > 0 ? ` (only in ${elsewhere.join(', ')})` : ' in any locale';
      for (const u of uses) {
        issues.push({
          rule: 'undefined-key',
          severity: 'error',
          key,
          file: u.file,
          line: u.line,
          column: u.column,
          message: `${key} is used but not defined${elsewhere.length > 0 ? ` in ${base}${where}` : where}`,
        });
      }
    }
    return issues;
  },
};

export const dynamicKey: Check = {
  id: 'dynamic-key',
  description: 'A translation call with a computed key; it cannot be checked and is skipped.',
  defaultSeverity: 'info',
  needsUsage: true,
  run(ctx) {
    return ctx.dynamic.map((d) => ({
      rule: 'dynamic-key',
      severity: 'info' as const,
      file: d.file,
      line: d.line,
      column: d.column,
      message: `Dynamic key ${d.expression}, skipped${d.prefix ? `; keys starting with "${d.prefix}" count as used` : ''}`,
    }));
  },
};

function pairs(ctx: CheckContext): Array<{ base: Entry; entry: Entry }> {
  const out: Array<{ base: Entry; entry: Entry }> = [];
  for (const locale of ctx.catalog.locales) {
    if (locale === ctx.catalog.baseLocale) continue;
    for (const [key, entry] of ctx.catalog.entries.get(locale)!) {
      const base = ctx.base.get(key);
      if (base && !ctx.ignored(key)) out.push({ base, entry });
    }
  }
  return out;
}

export const placeholderMismatch: Check = {
  id: 'placeholder-mismatch',
  description:
    'A translation is missing a placeholder of the base text, or adds one: {name}, {{name}}, %s, <tag>, $t(...), @:key.',
  defaultSeverity: 'error',
  run(ctx) {
    const issues: Issue[] = [];
    for (const { base, entry } of pairs(ctx)) {
      if (entry.text.trim() === '' || typeof entry.value !== 'string') continue;
      const d = comparePlaceholders(base.text, entry.text, ctx.messageFormat);
      // Singular forms often spell the number out: "one item" instead of "{{count}} item".
      const p = ctx.pluralSuffixes ? splitPluralKey(entry.key) : undefined;
      if (p && ['zero', 'one', 'two'].includes(p.category))
        d.missing = d.missing.filter((t) => t !== '{{count}}' && t !== '{count}');
      if (d.missing.length === 0 && d.extra.length === 0) continue;
      const parts: string[] = [];
      if (d.missing.length > 0) parts.push(`lacks ${d.missing.join(', ')}`);
      if (d.extra.length > 0) parts.push(`adds ${d.extra.join(', ')}`);
      issues.push({
        rule: 'placeholder-mismatch',
        severity: 'error',
        key: entry.key,
        locale: entry.locale,
        file: entry.file,
        line: entry.line,
        message: `${entry.key} in ${entry.locale} ${parts.join(' and ')} (${ctx.catalog.baseLocale}: ${quote(base.text)})`,
      });
    }
    return issues;
  },
};

export const icuSyntax: Check = {
  id: 'icu-syntax',
  description: 'An ICU message does not parse (unbalanced braces, a plural without "other", ...).',
  defaultSeverity: 'error',
  run(ctx) {
    if (ctx.messageFormat !== 'icu') return [];
    const issues: Issue[] = [];
    for (const locale of ctx.catalog.locales) {
      for (const [key, e] of ctx.catalog.entries.get(locale)!) {
        if (typeof e.value !== 'string' || ctx.ignored(key)) continue;
        const r = parseIcu(e.text);
        if (!r.ok)
          issues.push({
            rule: 'icu-syntax',
            severity: 'error',
            key,
            locale,
            file: e.file,
            line: e.line,
            message: `${key} in ${locale} is not a valid ICU message: ${r.error}`,
          });
      }
    }
    return issues;
  },
};

export const pluralForms: Check = {
  id: 'plural-forms',
  description:
    'A plural message lacks a plural category the locale needs (from Intl.PluralRules), e.g. "few" in Polish or Arabic.',
  defaultSeverity: 'warning',
  run(ctx) {
    const issues: Issue[] = [];
    // i18next suffixes: item_one, item_other, ...
    if (ctx.pluralSuffixes) {
      const stems = new Map<string, { ordinal: boolean; entry: Entry }>();
      for (const [key, e] of ctx.base) {
        const p = splitPluralKey(key);
        if (p) stems.set(`${p.stem}|${p.ordinal}`, { ordinal: p.ordinal, entry: e });
      }
      for (const locale of ctx.catalog.locales) {
        const map = ctx.catalog.entries.get(locale)!;
        for (const [id, { ordinal, entry }] of stems) {
          const stem = id.slice(0, id.lastIndexOf('|'));
          if (ctx.ignored(stem)) continue;
          const variants = PLURAL_KEYS.map((c) => `${stem}${ordinal ? '_ordinal' : ''}_${c}`);
          if (!variants.some((v) => map.has(v))) continue; // reported by missing-key
          const need = pluralCategories(locale, ordinal ? 'ordinal' : 'cardinal');
          const missing = need.filter((c) => !map.has(`${stem}${ordinal ? '_ordinal' : ''}_${c}`));
          if (missing.length === 0) continue;
          const file = fileFor(ctx, locale, entry.namespace) ?? entry.file;
          issues.push({
            rule: 'plural-forms',
            severity: 'warning',
            key: stem,
            locale,
            file,
            message: `${stem} in ${locale} lacks the plural form${missing.length === 1 ? '' : 's'} ${missing.map((c) => `_${c}`).join(', ')} (${locale} uses ${need.join(', ')})`,
          });
        }
      }
    }
    // ICU: {count, plural, one {...} other {...}}
    if (ctx.messageFormat === 'icu') {
      for (const { base, entry } of pairs(ctx)) {
        if (typeof entry.value !== 'string') continue;
        const b = parseIcu(base.text);
        const t = parseIcu(entry.text);
        if (!b.ok || !t.ok) continue;
        for (const arg of b.arguments) {
          if (arg.type !== 'plural' && arg.type !== 'selectordinal') continue;
          const mine = t.arguments.find((a) => a.name === arg.name && a.type === arg.type);
          if (!mine) continue;
          const need = pluralCategories(entry.locale, arg.type === 'selectordinal' ? 'ordinal' : 'cardinal');
          const missing = need.filter((c) => !mine.cases!.includes(c));
          if (missing.length === 0) continue;
          issues.push({
            rule: 'plural-forms',
            severity: 'warning',
            key: entry.key,
            locale: entry.locale,
            file: entry.file,
            line: entry.line,
            message: `${entry.key} in ${entry.locale}: {${arg.name}, ${arg.type}} lacks ${missing.join(', ')} (${entry.locale} uses ${need.join(', ')})`,
          });
        }
      }
    }
    return issues;
  },
};

const PLURAL_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'];

export const emptyValue: Check = {
  id: 'empty-value',
  description: 'A translation is an empty string (or a fuzzy gettext entry).',
  defaultSeverity: 'warning',
  run(ctx) {
    const issues: Issue[] = [];
    for (const locale of ctx.catalog.locales) {
      for (const [key, e] of ctx.catalog.entries.get(locale)!) {
        if (typeof e.value !== 'string' || e.text.trim() !== '' || ctx.ignored(key)) continue;
        issues.push({
          rule: 'empty-value',
          severity: 'warning',
          key,
          locale,
          file: e.file,
          line: e.line,
          message: `${key} is empty in ${locale}`,
        });
      }
    }
    return issues;
  },
};

export const untranslated: Check = {
  id: 'untranslated',
  description: 'A translation is identical to the base text, so it was probably never translated.',
  defaultSeverity: 'info',
  run(ctx) {
    const issues: Issue[] = [];
    const baseLang = language(ctx.catalog.baseLocale);
    for (const { base, entry } of pairs(ctx)) {
      if (language(entry.locale) === baseLang) continue; // en-GB may match en
      if (typeof entry.value !== 'string' || entry.text !== base.text || ctx.ignoredUntranslated(entry.key))
        continue;
      // Only text with words; placeholders, numbers, URLs and symbols stay the same.
      const words = entry.text
        .replace(/\{\{[^}]*\}\}|\{[^}]*\}|%\w|<[^>]+>|https?:\/\/\S+/g, '')
        .match(/\p{L}{2,}/gu);
      if (!words) continue;
      issues.push({
        rule: 'untranslated',
        severity: 'info',
        key: entry.key,
        locale: entry.locale,
        file: entry.file,
        line: entry.line,
        message: `${entry.key} in ${entry.locale} is the same as in ${ctx.catalog.baseLocale}: ${quote(entry.text)}`,
      });
    }
    return issues;
  },
};

export const duplicateKey: Check = {
  id: 'duplicate-key',
  description: 'A key appears twice in the same file; only the last value is used.',
  defaultSeverity: 'error',
  run(ctx) {
    const issues: Issue[] = [];
    for (const f of ctx.catalog.files) {
      for (const d of f.duplicates) {
        const key = d.path.join(ctx.catalog.keySeparator);
        issues.push({
          rule: 'duplicate-key',
          severity: 'error',
          key,
          locale: f.locale,
          file: f.path,
          line: d.line,
          message: `${key} is defined twice (first on line ${d.firstLine}); the last value wins`,
        });
      }
    }
    for (const c of ctx.catalog.conflicts) {
      issues.push({
        rule: 'duplicate-key',
        severity: 'error',
        key: c.key,
        locale: c.locale,
        file: c.file,
        line: c.line,
        message: c.message,
      });
    }
    return issues;
  },
};

export const parseError: Check = {
  id: 'parse-error',
  description: 'A locale file could not be read.',
  defaultSeverity: 'error',
  run(ctx) {
    return ctx.catalog.files.flatMap((f) =>
      f.errors.map((e) => ({
        rule: 'parse-error',
        severity: 'error' as const,
        locale: f.locale,
        file: f.path,
        line: e.line,
        column: e.column,
        message: `${f.path}: ${e.message}`,
      })),
    );
  },
};

/** The built-in checks, in report order. */
export const builtinChecks: Check[] = [
  parseError,
  duplicateKey,
  missingKey,
  undefinedKey,
  placeholderMismatch,
  icuSyntax,
  pluralForms,
  emptyValue,
  extraKey,
  unusedKey,
  untranslated,
  dynamicKey,
];
