import { callArguments, findCalls, LineIndex, maskHtmlComments, maskJs, readStringArg } from './source.js';
import type { DynamicKey, ExtractResult, UsedKey } from './types.js';

/** Where a call was found and how its key should be qualified. */
export interface CallContext {
  extractor: string;
  file: string;
  lines: LineIndex;
  result: ExtractResult;
}

export function emptyResult(): ExtractResult {
  return { keys: [], dynamic: [] };
}

export function createContext(extractor: string, file: string, text: string): CallContext {
  return { extractor, file, lines: new LineIndex(text), result: emptyResult() };
}

export function addKey(ctx: CallContext, key: string, offset: number, extra: Partial<UsedKey> = {}): void {
  if (key === '') return;
  const pos = ctx.lines.position(offset);
  const used: UsedKey = { key, file: ctx.file, line: pos.line, column: pos.column, extractor: ctx.extractor };
  if (extra.namespace !== undefined) used.namespace = extra.namespace;
  if (extra.plural) used.plural = true;
  ctx.result.keys.push(used);
}

export function addDynamic(
  ctx: CallContext,
  expression: string,
  prefix: string,
  offset: number,
  namespace?: string,
): void {
  const pos = ctx.lines.position(offset);
  const d: DynamicKey = {
    expression: expression.length > 80 ? `${expression.slice(0, 79)}…` : expression,
    prefix,
    file: ctx.file,
    line: pos.line,
    column: pos.column,
    extractor: ctx.extractor,
  };
  if (namespace !== undefined) d.namespace = namespace;
  ctx.result.dynamic.push(d);
}

/** True when the "call" is really a function or method definition: `t(key: string) {`. */
export function isDefinition(src: string, open: number, expression?: string): boolean {
  if (expression && /^[\w$]+\s*\??\s*:/.test(expression)) return true;
  const args = callArguments(src, open);
  const rest = src.slice(open + args.length + 1, open + args.length + 40);
  return /^\s*(?::\s*[\w$<>[\]|. ]+)?\s*(\{|=>)/.test(rest);
}

export interface CallMatch {
  name: string;
  /** Offset of the callee. */
  index: number;
  /** Offset just after `(`. */
  open: number;
  /** Arguments text. */
  args: string;
}

/**
 * Finds calls by name in JavaScript source, reads the first argument as a
 * key and records it (static) or reports it (dynamic). `qualify` may turn
 * the raw key into key + namespace. Returns the matches for extra handling.
 */
export function scanCalls(
  ctx: CallContext,
  original: string,
  code: string,
  names: string[],
  qualify: (key: string, match: CallMatch) => { key: string; namespace?: string; plural?: boolean } = (
    key,
  ) => ({ key }),
): CallMatch[] {
  const matches: CallMatch[] = [];
  for (const call of findCalls(code, names)) {
    const arg = readStringArg(original, call.open);
    if (!arg) continue;
    if (isDefinition(original, call.open, arg.kind === 'dynamic' ? arg.expression : undefined)) continue;
    const match: CallMatch = { ...call, args: callArguments(original, call.open) };
    matches.push(match);
    if (arg.kind === 'static') {
      const q = qualify(arg.value, match);
      addKey(ctx, q.key, arg.start, q);
    } else {
      const q = qualify(arg.prefix, match);
      addDynamic(ctx, arg.expression, arg.prefix === '' ? '' : q.key, arg.start, q.namespace);
    }
  }
  return matches;
}

/** Masks for a JavaScript file, or for the script blocks of a Vue/Svelte file. */
export function jsMasks(text: string): { noComments: string; code: string } {
  return maskJs(text);
}

/**
 * Splits a single-file component into script and markup, keeping offsets:
 * each part is the full text with the other part blanked out.
 */
export function splitComponent(text: string): { script: string; markup: string } {
  const scriptRanges: Array<[number, number]> = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].indexOf('>') + 1;
    scriptRanges.push([start, start + m[1]!.length]);
  }
  const blankOut = (keep: (i: number) => boolean) =>
    text.replace(/[^\n]/g, (c, offset: number) => (keep(offset) ? c : ' '));
  const inScript = (i: number) => scriptRanges.some(([a, b]) => i >= a && i < b);
  return {
    script: blankOut(inScript),
    markup: maskHtmlComments(blankOut((i) => !inScript(i))),
  };
}

/** Plain text calls inside markup (templates): no string masking, since calls live inside attributes. */
export function scanMarkupCalls(
  ctx: CallContext,
  markup: string,
  names: string[],
  qualify?: (key: string, match: CallMatch) => { key: string; namespace?: string; plural?: boolean },
): CallMatch[] {
  return scanCalls(ctx, markup, markup, names, qualify);
}

/** Finds `<Tag ...>` openings and returns the full tag text, balancing `{}` and quotes (JSX). */
export function findTags(text: string, tag: RegExp): Array<{ index: number; text: string }> {
  const out: Array<{ index: number; text: string }> = [];
  const re = new RegExp(`<(?:${tag.source})(?=[\\s/>])`, 'g');
  for (const m of text.matchAll(re)) {
    let depth = 0;
    let quote: string | undefined;
    let k = m.index + m[0].length;
    for (; k < text.length; k++) {
      const c = text[k]!;
      if (quote) {
        if (c === quote) quote = undefined;
        continue;
      }
      if (c === '"' || c === "'" || (c === '`' && depth > 0)) quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth <= 0) break;
    }
    out.push({ index: m.index, text: text.slice(m.index, k + 1) });
  }
  return out;
}

/** Reads `name="value"`, `name='value'`, `name={'value'}`, `name={`value`}` or `name={expression}` attributes. */
export function scanAttribute(
  ctx: CallContext,
  text: string,
  tag: RegExp,
  attribute: string,
  onValue?: (value: string, offset: number, tagText: string) => void,
): void {
  const attrRe = new RegExp(`(?<![\\w:.-])${attribute}\\s*=\\s*(?=["'{])`);
  for (const t of findTags(text, tag)) {
    const m = attrRe.exec(t.text);
    if (!m) continue;
    const at = m.index + m[0].length;
    const open = t.text[at]!;
    if (open === '"' || open === "'") {
      const end = t.text.indexOf(open, at + 1);
      if (end === -1) continue;
      const value = t.text.slice(at + 1, end);
      const offset = t.index + at + 1;
      if (onValue) onValue(value, offset, t.text);
      else addKey(ctx, value, offset);
      continue;
    }
    // {expression}: a static string inside braces is still static.
    const inner = callArguments(t.text, at + 1);
    const arg = readStringArg(t.text, at + 1);
    const offset = t.index + at + 1 + (inner.length - inner.trimStart().length);
    if (arg?.kind === 'static' && t.text.slice(arg.end, at + 1 + inner.length).trim() === '') {
      if (onValue) onValue(arg.value, t.index + arg.start, t.text);
      else addKey(ctx, arg.value, t.index + arg.start);
    } else if (inner.trim() !== '') {
      addDynamic(ctx, inner.trim(), arg?.kind === 'dynamic' ? arg.prefix : '', offset);
    }
  }
}
