import {
  type DuplicateKey,
  type ObjectNode,
  objectNode,
  type ParsedTree,
  type ParseError,
  type TreeNode,
} from './tree.js';

/**
 * A small YAML reader for translation files. Supported: nested mappings by
 * indentation, plain, single- and double-quoted scalars (also over several
 * lines), block scalars (`|`, `|-`, `|+`, `>`, `>-`), sequences of scalars,
 * flow sequences `[a, b]`, comments, a leading `---`, and quoted keys.
 * Not supported: anchors, aliases, tags, flow mappings and multi-document
 * files; they produce a parse error with a line number.
 */
export function parseYamlTree(text: string): ParsedTree {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const duplicates: DuplicateKey[] = [];
  const errors: ParseError[] = [];
  const root = objectNode();
  // Stack of open mappings with their indentation.
  const stack: Array<{ indent: number; node: ObjectNode; path: string[]; firstLines: Map<string, number> }> =
    [{ indent: -1, node: root, path: [], firstLines: new Map() }];

  let i = 0;
  let seenContent = false;
  const err = (message: string, line: number, column = 1) => errors.push({ message, line, column });

  while (i < lines.length) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    i++;
    if (/^\s*(#.*)?$/.test(raw)) continue;
    if (!seenContent && /^---\s*$/.test(raw)) {
      seenContent = true;
      continue;
    }
    seenContent = true;
    if (/^(---|\.\.\.)\s*$/.test(raw)) {
      err('Multiple YAML documents are not supported', lineNo);
      break;
    }
    if (/^\t/.test(raw)) {
      err('Tabs are not allowed for indentation in YAML', lineNo);
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const content = raw.slice(indent);

    if (content.startsWith('- ') || content === '-') {
      err('A sequence is only supported as the value of a key', lineNo, indent + 1);
      continue;
    }

    const parsedKey = readKey(content);
    if (!parsedKey) {
      err(`Expected "key: value" but found: ${content.slice(0, 40)}`, lineNo, indent + 1);
      continue;
    }
    const { key, rest } = parsedKey;

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!;
    const path = [...parent.path, key];
    const first = parent.firstLines.get(key);
    if (first !== undefined) duplicates.push({ path, line: lineNo, firstLine: first });
    else parent.firstLines.set(key, lineNo);

    const value = stripComment(rest).trim();
    let child: TreeNode;

    if (value === '') {
      // A nested mapping, a sequence, or an empty value.
      const next = nextContentLine(lines, i);
      if (next && next.indent > indent && !next.content.startsWith('- ')) {
        const node = objectNode(lineNo, indent + 1);
        parent.node.children.set(key, node);
        stack.push({ indent, node, path, firstLines: new Map() });
        continue;
      }
      if (next && next.indent >= indent && next.content.startsWith('- ')) {
        const items: string[] = [];
        while (i < lines.length) {
          const l = lines[i]!;
          if (/^\s*(#.*)?$/.test(l)) {
            i++;
            continue;
          }
          const ind = l.length - l.trimStart().length;
          const c = l.slice(ind);
          if (ind < next.indent || !(c.startsWith('- ') || c === '-')) break;
          const item = stripComment(c.slice(1)).trim();
          const r = scalar(item, lines, i + 1, ind);
          if (r.error) err(r.error, i + 1, ind + 1);
          items.push(r.value);
          i = r.nextLine;
        }
        child = { kind: 'leaf', value: items, line: lineNo, column: indent + 1 };
      } else {
        child = { kind: 'leaf', value: '', line: lineNo, column: indent + 1 };
      }
    } else if (/^[|>]/.test(value)) {
      const block = blockScalar(value, lines, i, indent);
      if (block.error) err(block.error, lineNo, indent + 1);
      i = block.nextLine;
      child = { kind: 'leaf', value: block.value, line: lineNo, column: indent + 1 };
    } else if (/^[&*!]/.test(value)) {
      err('Anchors, aliases and tags are not supported', lineNo, indent + 1);
      child = { kind: 'leaf', value: '', line: lineNo, column: indent + 1 };
    } else if (value.startsWith('{')) {
      err('Flow mappings ({ ... }) are not supported; use indentation', lineNo, indent + 1);
      child = { kind: 'leaf', value: '', line: lineNo, column: indent + 1 };
    } else if (value.startsWith('[')) {
      const items = flowSequence(value);
      if (!items) err('Could not read the flow sequence', lineNo, indent + 1);
      child = { kind: 'leaf', value: items ?? [], line: lineNo, column: indent + 1 };
    } else {
      const r = scalar(rest.trim(), lines, i, indent);
      if (r.error) err(r.error, lineNo, indent + 1);
      i = r.nextLine;
      child = { kind: 'leaf', value: r.value, line: lineNo, column: indent + 1 };
    }
    parent.node.children.set(key, child);
  }
  return { root, duplicates, errors };
}

function nextContentLine(lines: string[], from: number): { indent: number; content: string } | undefined {
  for (let k = from; k < lines.length; k++) {
    const l = lines[k]!;
    if (/^\s*(#.*)?$/.test(l)) continue;
    const indent = l.length - l.trimStart().length;
    return { indent, content: l.slice(indent) };
  }
  return undefined;
}

/** Reads `key:` at the start of a line; the key may be quoted. */
function readKey(content: string): { key: string; rest: string } | undefined {
  if (content[0] === '"' || content[0] === "'") {
    const q = content[0];
    let k = 1;
    let key = '';
    while (k < content.length) {
      const c = content[k]!;
      if (q === '"' && c === '\\') {
        key += unescapeDouble(content.slice(k, k + 2));
        k += 2;
        continue;
      }
      if (c === q) {
        if (q === "'" && content[k + 1] === "'") {
          key += "'";
          k += 2;
          continue;
        }
        break;
      }
      key += c;
      k++;
    }
    const after = content.slice(k + 1);
    const m = /^\s*:(\s|$)/.exec(after);
    if (!m) return undefined;
    return { key, rest: after.slice(m[0].length) };
  }
  const m = /^([^\s:#][^:#]*?|[^\s:#]*?)\s*:(?:\s+|$)/.exec(content);
  if (!m || m[1] === '') return undefined;
  return { key: m[1]!, rest: content.slice(m[0].length) };
}

function stripComment(s: string): string {
  let quote: string | undefined;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (quote) {
      if (c === '\\' && quote === '"') k++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      if (k === 0 || /\s/.test(s[k - 1]!)) quote = c;
    } else if (c === '#' && (k === 0 || /\s/.test(s[k - 1]!))) return s.slice(0, k);
  }
  return s;
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\',
  '/': '/',
  '0': '\0',
  ' ': ' ',
  _: ' ',
};

function unescapeDouble(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (m, e: string) => {
    if (e.length > 1) return String.fromCodePoint(Number.parseInt(e.slice(1), 16));
    return ESCAPES[e] ?? m;
  });
}

/** Reads a scalar that may continue on more-indented lines. */
function scalar(
  first: string,
  lines: string[],
  from: number,
  indent: number,
): { value: string; nextLine: number; error?: string } {
  const q = first[0];
  if (q === '"' || q === "'") {
    let buf = first.slice(1);
    let next = from;
    for (;;) {
      const end = closingQuote(buf, q);
      if (end !== -1) {
        const body = buf.slice(0, end);
        const tail = stripComment(buf.slice(end + 1)).trim();
        const folded = foldLines(body);
        const value = q === '"' ? unescapeDouble(folded) : folded.replace(/''/g, "'");
        return tail === ''
          ? { value, nextLine: next }
          : { value, nextLine: next, error: `Unexpected text after the closing quote: ${tail}` };
      }
      if (next >= lines.length) return { value: buf, nextLine: next, error: 'Unterminated quoted string' };
      buf += `\n${lines[next]}`;
      next++;
    }
  }
  // Plain scalar, possibly folded over more-indented lines.
  let value = stripComment(first).trim();
  let next = from;
  while (next < lines.length) {
    const l = lines[next]!;
    if (/^\s*$/.test(l)) break;
    const ind = l.length - l.trimStart().length;
    if (ind <= indent || /^\s*#/.test(l)) break;
    value += ` ${stripComment(l).trim()}`;
    next++;
  }
  return { value, nextLine: next };
}

function closingQuote(s: string, q: string): number {
  for (let k = 0; k < s.length; k++) {
    if (q === '"' && s[k] === '\\') {
      k++;
      continue;
    }
    if (s[k] === q) {
      if (q === "'" && s[k + 1] === "'") {
        k++;
        continue;
      }
      return k;
    }
  }
  return -1;
}

/** YAML folding inside quoted scalars: single line breaks become spaces. */
function foldLines(s: string): string {
  if (!s.includes('\n')) return s;
  return s
    .split('\n')
    .map((l, idx) => (idx === 0 ? l.trimEnd() : l.trim()))
    .reduce(
      (acc, l, idx) => (idx === 0 ? l : l === '' ? `${acc}\n` : acc.endsWith('\n') ? acc + l : `${acc} ${l}`),
      '',
    );
}

function blockScalar(
  header: string,
  lines: string[],
  from: number,
  parentIndent: number,
): { value: string; nextLine: number; error?: string } {
  const m = /^([|>])([+-]?)(\d?)([+-]?)\s*$/.exec(header);
  if (!m) return { value: '', nextLine: from, error: `Invalid block scalar header "${header}"` };
  const folded = m[1] === '>';
  const chomp = m[2] || m[4];
  const body: string[] = [];
  let blockIndent = m[3] ? parentIndent + Number(m[3]) : -1;
  let next = from;
  while (next < lines.length) {
    const l = lines[next]!;
    if (/^\s*$/.test(l)) {
      body.push('');
      next++;
      continue;
    }
    const ind = l.length - l.trimStart().length;
    if (blockIndent === -1) {
      if (ind <= parentIndent) break;
      blockIndent = ind;
    }
    if (ind < blockIndent) break;
    body.push(l.slice(blockIndent));
    next++;
  }
  // Trailing empty lines belong to chomping, not to the content.
  let trailing = 0;
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
    trailing++;
  }
  let value: string;
  if (folded) {
    value = '';
    for (let k = 0; k < body.length; k++) {
      const l = body[k]!;
      const prev = body[k - 1];
      if (k === 0) value = l;
      else if (l === '') value += '\n';
      else if (prev === '') value += l;
      else if (/^\s/.test(l) || /^\s/.test(prev!)) value += `\n${l}`;
      else value += ` ${l}`;
    }
  } else value = body.join('\n');
  if (chomp === '-') return { value, nextLine: next };
  if (chomp === '+') return { value: value + '\n'.repeat(trailing + 1), nextLine: next };
  return { value: body.length > 0 ? `${value}\n` : '', nextLine: next };
}

function flowSequence(s: string): string[] | undefined {
  const body = stripComment(s).trim();
  if (!body.endsWith(']')) return undefined;
  const inner = body.slice(1, -1).trim();
  if (inner === '') return [];
  const out: string[] = [];
  let cur = '';
  let quote: string | undefined;
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = undefined;
      else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const PLAIN_SAFE = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;

/** Quotes a string only when YAML would read it differently. */
export function yamlScalar(value: string): string {
  if (value === '') return '""';
  if (
    PLAIN_SAFE.test(value) &&
    !RESERVED.test(value) &&
    !/^[-+]?(\d|\.\d)/.test(value) &&
    value.trim() === value
  ) {
    if (!value.includes(': ') && !value.includes(' #')) return value;
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

function yamlKey(key: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_.\- ]*$/.test(key) && key.trim() === key && !RESERVED.test(key)
    ? key
    : `"${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Serializes a tree as YAML with two-space indentation. Multiline text uses block scalars. */
export function stringifyYamlTree(root: ObjectNode, indentSize = 2): string {
  const out: string[] = [];
  const pad = ' '.repeat(indentSize);
  const write = (node: ObjectNode, prefix: string) => {
    for (const [key, child] of node.children) {
      const k = yamlKey(key);
      if (child.kind === 'object') {
        if (child.children.size === 0) out.push(`${prefix}${k}: {}`);
        else {
          out.push(`${prefix}${k}:`);
          write(child, prefix + pad);
        }
        continue;
      }
      const v = child.value;
      if (Array.isArray(v)) {
        if (v.length === 0) out.push(`${prefix}${k}: []`);
        else {
          out.push(`${prefix}${k}:`);
          for (const item of v) out.push(`${prefix}${pad}- ${yamlScalar(String(item))}`);
        }
      } else if (typeof v === 'string' && v.includes('\n') && !/^\s/.test(v) && !/[\t\r]/.test(v)) {
        const chomp = v.endsWith('\n') ? (v.endsWith('\n\n') ? '+' : '') : '-';
        const body = v.endsWith('\n') ? v.replace(/\n+$/, '') : v;
        out.push(`${prefix}${k}: |${chomp}`);
        for (const l of body.split('\n')) out.push(l === '' ? '' : `${prefix}${pad}${l}`);
        if (chomp === '+') for (let n = 1; n < v.length - v.replace(/\n+$/, '').length; n++) out.push('');
      } else if (typeof v === 'string') out.push(`${prefix}${k}: ${yamlScalar(v)}`);
      else out.push(`${prefix}${k}: ${v === null ? 'null' : String(v)}`);
    }
  };
  write(root, '');
  return `${out.join('\n')}\n`;
}
