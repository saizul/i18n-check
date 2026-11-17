import { type DuplicateKey, objectNode, type ParsedTree, type ParseError } from './tree.js';

/** Separator between msgctxt and msgid in keys: `menu|Open`. */
export const PO_CONTEXT_SEPARATOR = '|';

export interface PoEntry {
  context?: string;
  id: string;
  plural?: string;
  /** msgstr, or msgstr[0..n] for plural entries. */
  strings: string[];
  fuzzy: boolean;
  line: number;
}

export interface PoFile {
  headers: Record<string, string>;
  entries: PoEntry[];
  errors: ParseError[];
}

/**
 * Minimal gettext `.po` reader: msgctxt, msgid, msgid_plural, msgstr and
 * msgstr[n], multi-line strings, `#,` flags (fuzzy) and the header entry.
 * Obsolete entries (`#~`) are ignored.
 */
export function parsePo(text: string): PoFile {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const entries: PoEntry[] = [];
  const errors: ParseError[] = [];
  let headers: Record<string, string> = {};
  let cur: Partial<PoEntry> & { strings: string[] } = { strings: [] };
  let field: { name: string; index?: number } | undefined;
  let fuzzy = false;
  let startLine = 0;

  const flush = () => {
    if (cur.id !== undefined) {
      if (cur.id === '' && cur.context === undefined) headers = parseHeaders(cur.strings[0] ?? '');
      else {
        const e: PoEntry = { id: cur.id, strings: cur.strings, fuzzy, line: startLine };
        if (cur.context !== undefined) e.context = cur.context;
        if (cur.plural !== undefined) e.plural = cur.plural;
        entries.push(e);
      }
    }
    cur = { strings: [] };
    field = undefined;
    fuzzy = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const no = i + 1;
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('#~')) continue;
    if (line.startsWith('#,')) {
      if (cur.id !== undefined) flush();
      if (/\bfuzzy\b/.test(line)) fuzzy = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    const m = /^(msgctxt|msgid_plural|msgid|msgstr)(?:\[(\d+)\])?\s+(".*")$/.exec(line);
    if (m) {
      const name = m[1]!;
      // A new msgctxt or msgid after a msgstr starts the next entry.
      if ((name === 'msgid' || name === 'msgctxt') && cur.strings.length > 0) flush();
      if (cur.id === undefined && cur.context === undefined) startLine = no;
      const value = unquote(m[3]!, no, errors);
      field = { name };
      if (m[2] !== undefined) field.index = Number(m[2]);
      assign(cur, field, value);
      continue;
    }
    if (line.startsWith('"') && field) {
      assign(cur, field, unquote(line, no, errors), true);
      continue;
    }
    errors.push({ message: `Cannot parse line: ${line.slice(0, 40)}`, line: no, column: 1 });
  }
  flush();
  return { headers, entries, errors };
}

function assign(
  cur: Partial<PoEntry> & { strings: string[] },
  field: { name: string; index?: number },
  v: string,
  append = false,
) {
  switch (field.name) {
    case 'msgctxt':
      cur.context = append ? (cur.context ?? '') + v : v;
      break;
    case 'msgid':
      cur.id = append ? (cur.id ?? '') + v : v;
      break;
    case 'msgid_plural':
      cur.plural = append ? (cur.plural ?? '') + v : v;
      break;
    default: {
      const idx = field.index ?? 0;
      cur.strings[idx] = append ? (cur.strings[idx] ?? '') + v : v;
    }
  }
}

function unquote(s: string, line: number, errors: ParseError[]): string {
  if (!/^".*"$/.test(s)) {
    errors.push({ message: 'Expected a quoted string', line, column: 1 });
    return '';
  }
  return s.slice(1, -1).replace(/\\(["\\nrt]|[0-7]{1,3})/g, (_m, e: string) => {
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(Number.parseInt(e, 8));
    return ({ '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' } as Record<string, string>)[e]!;
  });
}

function parseHeaders(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** The key used for a PO entry: msgid, prefixed by `msgctxt|` when there is a context. */
export function poKey(e: PoEntry): string {
  return e.context !== undefined ? `${e.context}${PO_CONTEXT_SEPARATOR}${e.id}` : e.id;
}

/**
 * A PO file as a flat tree. The value is msgstr (msgstr[0] for plurals), or
 * an empty string for fuzzy entries, which gettext does not use either.
 * With `useIdAsValue`, an empty msgstr falls back to msgid; that is how the
 * source-language catalog is read.
 */
export function parsePoTree(text: string, useIdAsValue = false): ParsedTree & { po: PoFile } {
  const po = parsePo(text);
  const root = objectNode();
  const duplicates: DuplicateKey[] = [];
  const seen = new Map<string, number>();
  for (const e of po.entries) {
    const key = poKey(e);
    const first = seen.get(key);
    if (first !== undefined) duplicates.push({ path: [key], line: e.line, firstLine: first });
    else seen.set(key, e.line);
    let value = e.fuzzy ? '' : (e.strings[0] ?? '');
    if (value === '' && useIdAsValue) value = e.id;
    root.children.set(key, { kind: 'leaf', value, line: e.line, column: 1 });
  }
  return { root, duplicates, errors: po.errors, po };
}
