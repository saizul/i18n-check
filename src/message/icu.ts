/** One argument of an ICU message, e.g. `{count, plural, one {...} other {...}}`. */
export interface IcuArgument {
  name: string;
  /** `simple` for `{name}`, otherwise number, date, time, plural, selectordinal, select, ... */
  type: string;
  /** Case selectors for plural, selectordinal and select (`one`, `other`, `=0`, `male`). */
  cases?: string[];
}

export interface IcuResult {
  ok: boolean;
  error?: string;
  arguments: IcuArgument[];
  /** Rich text tags such as `<link>` used by next-intl and react-intl. */
  tags: string[];
}

class IcuSyntaxError extends Error {}

/**
 * Parses an ICU MessageFormat string far enough to compare translations:
 * argument names and types, plural/select cases and rich text tags. Handles
 * nesting and apostrophe quoting (`'{'`, `''`).
 */
export function parseIcu(text: string): IcuResult {
  const args: IcuArgument[] = [];
  const tags = new Set<string>();
  let i = 0;

  const fail = (msg: string): never => {
    throw new IcuSyntaxError(`${msg} at position ${i + 1}`);
  };

  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };

  const word = (): string => {
    const start = i;
    while (i < text.length && !/[\s,{}]/.test(text[i]!)) i++;
    return text.slice(start, i);
  };

  // Reads message text until an unmatched `}` (when nested) or the end.
  const message = (nested: boolean, inPlural: boolean) => {
    while (i < text.length) {
      const c = text[i]!;
      if (c === "'") {
        const next = text[i + 1];
        if (next === "'") {
          i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (inPlural && next === '#') || next === '<') {
          const end = text.indexOf("'", i + 1);
          i = end === -1 ? text.length : end + 1;
          continue;
        }
        i++;
        continue;
      }
      if (c === '{') {
        argument();
        continue;
      }
      if (c === '}') {
        if (nested) return;
        fail('Unexpected "}"');
      }
      if (c === '<') {
        const m = /^<\/?([A-Za-z][\w-]*)\s*\/?>/.exec(text.slice(i));
        if (m) {
          tags.add(m[1]!);
          i += m[0].length;
          continue;
        }
      }
      i++;
    }
    if (nested) fail('Missing "}"');
  };

  const argument = () => {
    i++; // {
    ws();
    const name = word();
    if (name === '') fail('Empty argument name');
    ws();
    if (text[i] === '}') {
      i++;
      args.push({ name, type: 'simple' });
      return;
    }
    if (text[i] !== ',') fail(`Expected "," or "}" after "${name}"`);
    i++;
    ws();
    const type = word();
    ws();
    if (type === 'plural' || type === 'selectordinal' || type === 'select') {
      if (text[i] !== ',') fail(`Expected "," after "${type}"`);
      i++;
      const cases: string[] = [];
      for (;;) {
        ws();
        if (text[i] === '}') {
          i++;
          break;
        }
        if (i >= text.length) fail(`Unterminated ${type} argument "${name}"`);
        const selector = word();
        if (selector.startsWith('offset:')) continue;
        if (selector === '') fail(`Expected a case in "${name}"`);
        ws();
        if (text[i] !== '{') fail(`Expected "{" after case "${selector}" of "${name}"`);
        i++;
        message(true, type !== 'select');
        if (text[i] !== '}') fail(`Unterminated case "${selector}" of "${name}"`);
        i++;
        cases.push(selector);
      }
      if (!cases.includes('other')) fail(`"${name}" has no "other" case`);
      args.push({ name, type, cases });
      return;
    }
    // number, date, time, list, ... with an optional style: skip to the matching brace.
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    if (depth > 0) fail(`Unterminated argument "${name}"`);
    args.push({ name, type: type || 'simple' });
  };

  try {
    message(false, false);
    return { ok: true, arguments: args, tags: [...tags] };
  } catch (err) {
    if (err instanceof IcuSyntaxError)
      return { ok: false, error: err.message, arguments: args, tags: [...tags] };
    throw err;
  }
}
