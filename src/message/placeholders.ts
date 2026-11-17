import type { MessageFormat } from '../config.js';
import { parseIcu } from './icu.js';

const I18NEXT_RE = /\{\{\s*-?\s*([^{}\s,]+)\s*(?:,[^{}]*)?\}\}/g;
const I18NEXT_NESTING_RE = /\$t\(\s*([^,)\s]+)/g;
const VUE_NAMED_RE = /(?<!\{)\{\s*([A-Za-z_$][\w$]*|\d+)\s*\}(?!\})/g;
const VUE_LINKED_RE = /@(?:\.[a-z]+)?:(?:\(([^)]+)\)|([\w.-]+))/g;
const PRINTF_RE =
  /%(?:\(([\w.]+)\)[-+0#]*\d*(?:\.\d+)?[sdifoxXeEgGcj]|(\d+\$)?[-+0#]*\d*(?:\.\d+)?[sdifxXeEgGcj])/g;

/** Placeholders in a message, as comparable tokens such as `{{name}}`, `{name}` or `%s`. */
export function extractPlaceholders(text: string, format: MessageFormat): string[] {
  const out: string[] = [];
  const add = (t: string) => out.push(t);
  const noEscapedPercent = text.replace(/%%/g, '');
  switch (format) {
    case 'i18next':
      for (const m of text.matchAll(I18NEXT_RE)) add(`{{${m[1]}}}`);
      for (const m of text.matchAll(I18NEXT_NESTING_RE)) add(`$t(${m[1]})`);
      break;
    case 'vue':
      for (const m of text.matchAll(VUE_NAMED_RE)) add(`{${m[1]}}`);
      for (const m of text.matchAll(VUE_LINKED_RE)) add(`@:${m[1] ?? m[2]}`);
      break;
    case 'icu': {
      const r = parseIcu(text);
      for (const a of r.arguments) add(`{${a.name}}`);
      for (const t of r.tags) add(`<${t}>`);
      break;
    }
    case 'printf':
      for (const m of noEscapedPercent.matchAll(PRINTF_RE)) add(m[0]);
      break;
    default: {
      for (const m of text.matchAll(I18NEXT_RE)) add(`{{${m[1]}}}`);
      const withoutDouble = text.replace(I18NEXT_RE, '');
      for (const m of withoutDouble.matchAll(VUE_NAMED_RE)) add(`{${m[1]}}`);
      for (const m of noEscapedPercent.matchAll(PRINTF_RE)) add(m[0]);
    }
  }
  // Named placeholders compare as a set; printf-style ones by count.
  const named = [...new Set(out.filter((t) => !t.startsWith('%') || t.startsWith('%(')))];
  const positional = out.filter((t) => t.startsWith('%') && !t.startsWith('%('));
  return [...named, ...positional].sort();
}

/** Differences between the placeholders of a base message and a translation. */
export function comparePlaceholders(
  base: string,
  translation: string,
  format: MessageFormat,
): { missing: string[]; extra: string[] } {
  const a = extractPlaceholders(base, format);
  const b = extractPlaceholders(translation, format);
  return { missing: multisetMinus(a, b), extra: multisetMinus(b, a) };
}

function multisetMinus(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const n = counts.get(x) ?? 0;
    if (n > 0) counts.set(x, n - 1);
    else out.push(x);
  }
  return [...new Set(out)];
}

const categoryCache = new Map<string, string[]>();

/** CLDR plural categories a locale needs, from `Intl.PluralRules` (e.g. bn: one, other). */
export function pluralCategories(locale: string, type: 'cardinal' | 'ordinal' = 'cardinal'): string[] {
  const id = `${locale}|${type}`;
  let cats = categoryCache.get(id);
  if (!cats) {
    try {
      cats = new Intl.PluralRules(locale.replace(/_/g, '-'), { type }).resolvedOptions()
        .pluralCategories as string[];
    } catch {
      cats = ['one', 'other'];
    }
    categoryCache.set(id, cats);
  }
  return cats;
}

export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Splits an i18next plural key: `item_one` -> { stem: 'item', category: 'one' }. */
export function splitPluralKey(
  key: string,
): { stem: string; category: string; ordinal: boolean } | undefined {
  const m = /^(.+?)(_ordinal)?_(zero|one|two|few|many|other)$/.exec(key);
  if (!m) return undefined;
  return { stem: m[1]!, category: m[3]!, ordinal: m[2] !== undefined };
}
