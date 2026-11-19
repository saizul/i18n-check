// Export untranslated keys for translators: CSV for spreadsheets, XLIFF 1.2
// for translation tools (CAT tools, Crowdin, Lokalise, Weblate, ...) and JSON.

import type { AnalyzeResult } from './analyze.js';

/** Why a key needs a translation. */
export type TaskReason = 'missing' | 'empty' | 'untranslated';

export const TASK_REASONS: readonly TaskReason[] = ['missing', 'empty', 'untranslated'];

export type ExportFormat = 'csv' | 'xliff' | 'json';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'xliff', 'json'];

/** One string a translator should work on. */
export interface TranslationTask {
  locale: string;
  /** Qualified key (`namespace:key` in namespaced layouts). */
  key: string;
  namespace?: string;
  /** The base locale text. */
  source: string;
  /** The current translation: empty for missing and empty values, the copied base text for untranslated ones. */
  target: string;
  reason: TaskReason;
}

const RULE_REASON: Record<string, TaskReason> = {
  'missing-key': 'missing',
  'empty-value': 'empty',
  untranslated: 'untranslated',
};

/** The rule IDs behind each reason, to pass to `analyze({ only })`. */
export const TASK_RULES: readonly string[] = Object.keys(RULE_REASON);

/**
 * Turns the `missing-key`, `empty-value` and `untranslated` issues of an
 * analysis into translation tasks, sorted by locale and key. Keys of the base
 * locale itself are never listed. Rules turned off in the config produce no
 * tasks.
 */
export function collectTasks(
  result: AnalyzeResult,
  include: readonly TaskReason[] = TASK_REASONS,
): TranslationTask[] {
  const { catalog, context } = result;
  const tasks: TranslationTask[] = [];
  const seen = new Set<string>();
  for (const issue of result.issues) {
    const reason = RULE_REASON[issue.rule];
    if (!reason || !include.includes(reason) || !issue.key || !issue.locale) continue;
    if (issue.locale === catalog.baseLocale) continue;
    const base = context.base.get(issue.key);
    if (!base || typeof base.value !== 'string') continue;
    const id = `${issue.locale}\u0000${issue.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = catalog.entries.get(issue.locale)?.get(issue.key);
    const task: TranslationTask = {
      locale: issue.locale,
      key: issue.key,
      source: base.text,
      target: reason === 'untranslated' && entry ? entry.text : '',
      reason,
    };
    if (base.namespace !== undefined) task.namespace = base.namespace;
    tasks.push(task);
  }
  tasks.sort((a, b) =>
    a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  return tasks;
}

/** A CSV cell (RFC 4180). Cells a spreadsheet would run as a formula get a leading `'`. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV with the columns `locale,key,source,target,reason` and CRLF line ends. */
export function tasksToCsv(tasks: readonly TranslationTask[]): string {
  const rows = [['locale', 'key', 'source', 'target', 'reason']];
  for (const t of tasks) rows.push([t.locale, t.key, t.source, t.target, t.reason]);
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/**
 * XLIFF 1.2 with one `<file>` per target locale. Each `<trans-unit>` has the
 * key as `id` and `resname`, the base text as `<source>`, the current text as
 * `<target state="needs-translation">` and the reason as a `<note>`.
 */
export function tasksToXliff(tasks: readonly TranslationTask[], sourceLanguage: string): string {
  const byLocale = new Map<string, TranslationTask[]>();
  for (const t of tasks) {
    const list = byLocale.get(t.locale) ?? [];
    list.push(t);
    byLocale.set(t.locale, list);
  }
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
  ];
  for (const [locale, list] of byLocale) {
    out.push(
      `  <file original="i18n-check" source-language="${xml(sourceLanguage)}" target-language="${xml(locale)}" datatype="plaintext">`,
      '    <body>',
    );
    for (const t of list) {
      out.push(
        `      <trans-unit id="${xml(t.key)}" resname="${xml(t.key)}" xml:space="preserve">`,
        `        <source>${xml(t.source)}</source>`,
        `        <target state="needs-translation">${xml(t.target)}</target>`,
        `        <note>${t.reason}</note>`,
        '      </trans-unit>',
      );
    }
    out.push('    </body>', '  </file>');
  }
  out.push('</xliff>');
  return `${out.join('\n')}\n`;
}

/** Renders tasks in one of the export formats. */
export function formatTasks(
  tasks: readonly TranslationTask[],
  format: ExportFormat,
  sourceLanguage: string,
): string {
  if (format === 'csv') return tasksToCsv(tasks);
  if (format === 'xliff') return tasksToXliff(tasks, sourceLanguage);
  if (format === 'json') return `${JSON.stringify({ sourceLanguage, tasks }, null, 2)}\n`;
  throw new Error(`format must be one of ${EXPORT_FORMATS.join(', ')}`);
}
