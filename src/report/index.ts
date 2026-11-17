import type { AnalyzeResult } from '../analyze.js';
import type { Issue, Severity } from '../checks/types.js';

export type Format = 'pretty' | 'json' | 'markdown' | 'github';

export interface Colors {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

export function colors(enabled: boolean): Colors {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    cyan: wrap(36, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function counts(issues: Issue[]): Record<Severity, number> {
  const c = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}

export function summaryLine(result: AnalyzeResult): string {
  const c = counts(result.issues);
  const n = result.catalog.locales.length;
  const keys = result.context.base.size;
  const src = result.usage ? `, ${plural(result.usage.files.length, 'source file')}` : '';
  return `${plural(c.error, 'error')}, ${plural(c.warning, 'warning')}, ${c.info} info · ${plural(n, 'locale')}, ${plural(keys, 'key')}${src}`;
}

/** Terminal output: a coverage table, then issues grouped by rule. */
export function formatPretty(
  result: AnalyzeResult,
  c: Colors,
  options: { minSeverity?: Severity } = {},
): string {
  const out: string[] = [];
  const { catalog } = result;
  const min = options.minSeverity ?? 'info';
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const shown = result.issues.filter((i) => rank[i.severity] <= rank[min]);

  out.push(
    c.dim(
      `Base locale ${catalog.baseLocale} · ${result.extractors.map((e) => e.id).join(', ')} · ${result.messageFormat} placeholders`,
    ),
  );
  out.push('');
  const width = Math.max(6, ...catalog.locales.map((l) => l.length));
  out.push(c.bold(`${'Locale'.padEnd(width)}  Keys   Missing  Empty  Coverage`));
  for (const s of result.stats) {
    const bar = coverageBar(s.coverage);
    const pct = `${s.coverage.toFixed(1)}%`.padStart(6);
    const colored = s.coverage === 100 ? c.green(pct) : s.coverage >= 90 ? c.yellow(pct) : c.red(pct);
    const label = s.locale === catalog.baseLocale ? `${s.locale}*` : s.locale;
    out.push(
      `${label.padEnd(width)}  ${String(s.keys).padStart(4)}   ${String(s.missing).padStart(7)}  ${String(s.empty).padStart(5)}  ${colored} ${c.dim(bar)}`,
    );
  }

  let lastRule = '';
  for (const issue of shown) {
    if (issue.rule !== lastRule) {
      const n = shown.filter((i) => i.rule === issue.rule).length;
      out.push('');
      out.push(`${sevLabel(issue.severity, c)} ${c.bold(issue.rule)} ${c.dim(`(${n})`)}`);
      lastRule = issue.rule;
    }
    const where = issue.file ? c.dim(`  ${issue.file}${issue.line ? `:${issue.line}` : ''}`) : '';
    out.push(`  ${issue.message}${where}`);
  }
  out.push('');
  const cnt = counts(result.issues);
  const mark = cnt.error > 0 ? c.red('✖') : cnt.warning > 0 ? c.yellow('⚠') : c.green('✔');
  out.push(`${mark} ${summaryLine(result)}`);
  return `${out.join('\n')}\n`;
}

function sevLabel(s: Severity, c: Colors): string {
  return s === 'error' ? c.red('error') : s === 'warning' ? c.yellow('warning') : c.cyan('info');
}

function coverageBar(pct: number): string {
  const full = Math.round(pct / 10);
  return '█'.repeat(full) + '░'.repeat(10 - full);
}

export function formatJson(result: AnalyzeResult): string {
  const c = counts(result.issues);
  return `${JSON.stringify(
    {
      baseLocale: result.catalog.baseLocale,
      locales: result.catalog.locales,
      extractors: result.extractors.map((e) => e.id),
      messageFormat: result.messageFormat,
      files: result.catalog.files.map((f) => ({
        path: f.path,
        locale: f.locale,
        namespace: f.namespace,
        format: f.format,
      })),
      sourceFiles: result.usage?.files.length,
      stats: result.stats,
      summary: c,
      issues: result.issues,
    },
    null,
    2,
  )}\n`;
}

function md(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Markdown for pull request comments and job summaries. */
export function formatMarkdown(result: AnalyzeResult): string {
  const out: string[] = ['## Translation check', ''];
  const c = counts(result.issues);
  out.push(`**${summaryLine(result)}**`, '');
  out.push('| Locale | Keys | Missing | Empty | Coverage |', '| --- | ---: | ---: | ---: | ---: |');
  for (const s of result.stats) {
    const label = s.locale === result.catalog.baseLocale ? `${s.locale} (base)` : s.locale;
    out.push(`| ${label} | ${s.keys} | ${s.missing} | ${s.empty} | ${s.coverage.toFixed(1)}% |`);
  }
  if (result.issues.length === 0) {
    out.push('', 'No problems found.');
    return `${out.join('\n')}\n`;
  }
  const rules = [...new Set(result.issues.map((i) => i.rule))];
  for (const rule of rules) {
    const list = result.issues.filter((i) => i.rule === rule);
    const sev = list[0]!.severity;
    out.push(
      '',
      `<details${sev === 'error' ? ' open' : ''}>`,
      `<summary><b>${rule}</b> (${list.length}, ${sev})</summary>`,
      '',
    );
    out.push('| Key | Locale | Message | Location |', '| --- | --- | --- | --- |');
    for (const i of list.slice(0, 200)) {
      const loc = i.file ? `\`${i.file}${i.line ? `:${i.line}` : ''}\`` : '';
      out.push(`| ${i.key ? `\`${md(i.key)}\`` : ''} | ${i.locale ?? ''} | ${md(i.message)} | ${loc} |`);
    }
    if (list.length > 200) out.push('', `…and ${list.length - 200} more.`);
    out.push('', '</details>');
  }
  if (c.error === 0) out.push('', 'No errors.');
  return `${out.join('\n')}\n`;
}

function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** GitHub Actions workflow commands; info issues become notices. */
export function formatGithub(result: AnalyzeResult): string {
  const lines = result.issues.map((i) => {
    const level = i.severity === 'info' ? 'notice' : i.severity;
    const props: string[] = [];
    if (i.file) props.push(`file=${escapeProperty(i.file)}`);
    if (i.line) props.push(`line=${i.line}`);
    if (i.column) props.push(`col=${i.column}`);
    props.push(`title=${escapeProperty(`i18n-check ${i.rule}`)}`);
    return `::${level} ${props.join(',')}::${escapeData(i.message)}`;
  });
  lines.push(summaryLine(result));
  return `${lines.join('\n')}\n`;
}

export function formatResult(
  result: AnalyzeResult,
  format: Format,
  c: Colors,
  minSeverity?: Severity,
): string {
  switch (format) {
    case 'json':
      return formatJson(result);
    case 'markdown':
      return formatMarkdown(result);
    case 'github':
      return formatGithub(result);
    default:
      return formatPretty(result, c, minSeverity ? { minSeverity } : {});
  }
}
