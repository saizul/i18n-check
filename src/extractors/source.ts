/**
 * Lightweight source helpers for extractors. They work on text, not on an
 * AST, so they are fast and dependency-free, and good enough for the call
 * shapes translation libraries use.
 */

/** Maps string offsets to 1-based line and column numbers. */
export class LineIndex {
  private readonly starts: number[] = [0];
  constructor(text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  position(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo]! + 1 };
  }
}

export interface Masks {
  /** Comments replaced by spaces; strings kept. Use it to read attributes and arguments. */
  noComments: string;
  /** Comments and the contents of strings replaced; quotes kept. Use it to find call sites. */
  code: string;
}

/**
 * Masks JavaScript/TypeScript source. Lengths and line breaks are kept so
 * offsets stay valid. `'` and `"` strings end at a line break, which limits
 * the damage of an apostrophe in JSX text such as `<p>Don't</p>`. Code
 * inside template literal `${...}` stays visible.
 */
export function maskJs(src: string): Masks {
  const n = src.length;
  const noComments = src.split('');
  const code = src.split('');
  const blank = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  // Stack of template literal states: the brace depth at which `${` was opened.
  const templateStack: number[] = [];
  let braceDepth = 0;
  let i = 0;
  let prevSignificant = '';

  const readTemplate = (start: number): number => {
    // `start` is just after the backtick or after the `}` closing an expression.
    let k = start;
    while (k < n) {
      const c = src[k];
      if (c === '\\') {
        k += 2;
        continue;
      }
      if (c === '`') {
        blank(code, start, k);
        return k + 1;
      }
      if (c === '$' && src[k + 1] === '{') {
        blank(code, start, k);
        templateStack.push(braceDepth);
        braceDepth++;
        return k + 2;
      }
      k++;
    }
    blank(code, start, n);
    return n;
  };

  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(noComments, i, stop);
      blank(code, i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(noComments, i, stop);
      blank(code, i, stop);
      i = stop;
      continue;
    }
    if ((c === '"' || c === "'") && isTextQuote(src, i, prevSignificant)) {
      // An apostrophe in JSX text (`<p>Don't</p>`) or a quote in prose: not a string.
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      blank(code, i + 1, Math.min(k, n));
      i = k < n && src[k] === c ? k + 1 : k;
      prevSignificant = 'x';
      continue;
    }
    if (c === '`') {
      i = readTemplate(i + 1);
      prevSignificant = 'x';
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prevSignificant)) {
      // A regular expression literal: skip it so quotes inside do not start strings.
      let k = i + 1;
      let inClass = false;
      while (k < n && src[k] !== '\n') {
        const ch = src[k];
        if (ch === '\\') {
          k += 2;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        k++;
      }
      if (k < n && src[k] === '/') {
        blank(code, i + 1, k);
        i = k + 1;
        prevSignificant = 'x';
        continue;
      }
    }
    if (c === '{') braceDepth++;
    else if (c === '}') {
      braceDepth--;
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        i = readTemplate(i + 1);
        prevSignificant = 'x';
        continue;
      }
    }
    if (!/\s/.test(c)) prevSignificant = /[\w$)\]]/.test(c) ? 'x' : c;
    i++;
  }
  return { noComments: noComments.join(''), code: code.join('') };
}

const KEYWORDS_BEFORE_VALUE = new Set([
  'return',
  'case',
  'typeof',
  'in',
  'of',
  'yield',
  'await',
  'void',
  'delete',
  'else',
  'do',
  'default',
  'throw',
  'instanceof',
  'from',
  'import',
  'export',
  'as',
  'satisfies',
]);

/**
 * A quote directly after a word that is not a keyword (`Don't`, `it's`,
 * `Let"s`) cannot start a string in JavaScript, so it must be text.
 */
function isTextQuote(src: string, i: number, prevSignificant: string): boolean {
  if (prevSignificant !== 'x') return false;
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k]!)) k--;
  const end = k + 1;
  while (k >= 0 && /[\w$]/.test(src[k]!)) k--;
  const word = src.slice(k + 1, end);
  if (word === '') return false; // after ) or ]: let the string through
  if (/^\d/.test(word)) return false;
  return !KEYWORDS_BEFORE_VALUE.has(word);
}

/** Removes HTML comments, keeping offsets. */
export function maskHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** A string argument read from source. */
export type StringArg =
  | { kind: 'static'; value: string; start: number; end: number }
  | { kind: 'dynamic'; expression: string; prefix: string; start: number; end: number };

/**
 * Reads the expression at `pos` (usually just after `(`) as a key. Static:
 * a plain string or a template literal without `${}`. Dynamic: anything
 * else; `prefix` is the static start, e.g. `errors.` for `` `errors.${code}` ``.
 */
export function readStringArg(src: string, pos: number): StringArg | undefined {
  let i = pos;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  const start = i;
  const q = src[i];
  if (q === ')' || q === undefined) return undefined;
  if (q === '"' || q === "'" || q === '`') {
    let k = i + 1;
    let value = '';
    let dynamic = false;
    let prefix = '';
    while (k < src.length && src[k] !== q) {
      const c = src[k]!;
      if (c === '\\') {
        const e = src[k + 1] ?? '';
        value += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        k += 2;
        continue;
      }
      if (q === '`' && c === '$' && src[k + 1] === '{') {
        if (!dynamic) prefix = value;
        dynamic = true;
      }
      if (c === '\n' && q !== '`') return undefined;
      value += c;
      k++;
    }
    if (k >= src.length) return undefined;
    let end = k + 1;
    let j = end;
    while (j < src.length && /\s/.test(src[j]!)) j++;
    const after = src[j];
    if (after === '+' || after === '?' || after === '[' || after === '.') {
      // 'prefix.' + name, or 'a'.concat(...)
      const exprEnd = expressionEnd(src, start);
      return {
        kind: 'dynamic',
        expression: src.slice(start, exprEnd).trim(),
        prefix: dynamic ? prefix : value,
        start,
        end: exprEnd,
      };
    }
    if (dynamic) return { kind: 'dynamic', expression: src.slice(start, end), prefix, start, end };
    end = k + 1;
    return { kind: 'static', value, start, end };
  }
  const exprEnd = expressionEnd(src, start);
  const expression = src.slice(start, exprEnd).trim();
  if (expression === '') return undefined;
  return { kind: 'dynamic', expression, prefix: '', start, end: exprEnd };
}

/** End of the expression starting at `pos`: the first `,` or `)` at depth 0. */
export function expressionEnd(src: string, pos: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let k = pos; k < src.length; k++) {
    const c = src[k]!;
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return k;
      depth--;
    } else if (c === ',' && depth === 0) return k;
    else if (c === '\n' && depth === 0 && k - pos > 200) return k;
  }
  return src.length;
}

/** The text of the call arguments starting after `(`, up to the matching `)`. */
export function callArguments(src: string, open: number): string {
  let depth = 0;
  let quote: string | undefined;
  for (let k = open; k < src.length; k++) {
    const c = src[k]!;
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return src.slice(open, k);
      depth--;
    }
  }
  return src.slice(open);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds calls to any of the function names (which may contain dots, like
 * `i18n.t` or `this.$t`). Returns offsets just after the `(`. A name never
 * matches as the tail of a longer identifier (`format(` is not `t(`) and
 * function declarations are skipped.
 */
export function findCalls(
  code: string,
  names: string[],
): Array<{ name: string; index: number; open: number }> {
  if (names.length === 0) return [];
  const sorted = [...names].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(?<![\\w$])(${sorted.join('|')})\\s*(?:<[^>()]*>)?\\s*\\(`, 'g');
  const out: Array<{ name: string; index: number; open: number }> = [];
  for (const m of code.matchAll(re)) {
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    if (/\bfunction\s*\*?\s*$/.test(before) || /\b(?:def|fun)\s+$/.test(before)) continue;
    // Method definitions inside classes or objects: `t(key: string) {`.
    out.push({ name: m[1]!, index: m.index, open: m.index + m[0].length });
  }
  return out;
}

/** Reads `ns: 'x'` or `keyPrefix: 'x'` style option values from argument text. */
export function readOption(args: string, name: string): string | undefined {
  const m = new RegExp(`(?<![\\w$])${escapeRe(name)}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(args);
  return m ? m[2] : undefined;
}
