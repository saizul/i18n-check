import { type DuplicateKey, type ObjectNode, objectNode, type ParsedTree, type TreeNode } from './tree.js';

class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
  }
}

/**
 * Parses JSON into an ordered tree that remembers the line of every key and
 * reports duplicate keys (which `JSON.parse` silently drops). Comments and
 * trailing commas, common in hand-edited files, are accepted with a warning-free
 * pass so that one stray comma does not hide every other result.
 */
export function parseJsonTree(text: string): ParsedTree {
  const src = text.replace(/^﻿/, '');
  let i = 0;
  let line = 1;
  let col = 1;
  const duplicates: DuplicateKey[] = [];

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };
  const fail = (msg: string): never => {
    throw new JsonSyntaxError(msg, line, col);
  };
  const skip = () => {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') advance();
      else if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') advance();
      } else if (c === '/' && src[i + 1] === '*') {
        advance(2);
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) advance();
        if (i >= src.length) fail('Unterminated comment');
        advance(2);
      } else return;
    }
  };

  const parseString = (): string => {
    if (src[i] !== '"') fail(`Expected a string but found ${describe(src[i])}`);
    advance();
    let out = '';
    for (;;) {
      const c = src[i];
      if (c === undefined || c === '\n') fail('Unterminated string');
      if (c === '"') {
        advance();
        return out;
      }
      if (c === '\\') {
        const e = src[i + 1];
        const map: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        if (e === 'u') {
          const hex = src.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape');
          out += String.fromCharCode(Number.parseInt(hex, 16));
          advance(6);
          continue;
        }
        if (e === undefined || !(e in map)) fail(`Invalid escape \\${e ?? ''}`);
        out += map[e!];
        advance(2);
        continue;
      }
      out += c;
      advance();
    }
  };

  const parsePlain = (): unknown => {
    skip();
    const c = src[i];
    if (c === '{') return toPlainObject(parseObject([]));
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(src.slice(i, i + 64));
    if (!m) fail(`Unexpected ${describe(c)}`);
    advance(m![0].length);
    const t = m![0];
    return t === 'true' ? true : t === 'false' ? false : t === 'null' ? null : Number(t);
  };

  const parseArray = (): unknown[] => {
    advance(); // [
    const out: unknown[] = [];
    skip();
    if (src[i] === ']') {
      advance();
      return out;
    }
    for (;;) {
      out.push(parsePlain());
      skip();
      if (src[i] === ',') {
        advance();
        skip();
        if (src[i] === ']') {
          advance();
          return out;
        }
        continue;
      }
      if (src[i] === ']') {
        advance();
        return out;
      }
      fail(`Expected , or ] but found ${describe(src[i])}`);
    }
  };

  const parseObject = (path: string[]): ObjectNode => {
    const node = objectNode(line, col);
    advance(); // {
    const firstLines = new Map<string, number>();
    skip();
    if (src[i] === '}') {
      advance();
      return node;
    }
    for (;;) {
      skip();
      const keyLine = line;
      const keyCol = col;
      const key = parseString();
      skip();
      if (src[i] !== ':') fail(`Expected : after "${key}"`);
      advance();
      skip();
      let child: TreeNode;
      if (src[i] === '{') child = parseObject([...path, key]);
      else {
        const value = parsePlain();
        child = { kind: 'leaf', value, line: keyLine, column: keyCol };
      }
      if (child.kind === 'object') {
        child.line = keyLine;
        child.column = keyCol;
      }
      const first = firstLines.get(key);
      if (first !== undefined) duplicates.push({ path: [...path, key], line: keyLine, firstLine: first });
      else firstLines.set(key, keyLine);
      node.children.set(key, child);
      skip();
      if (src[i] === ',') {
        advance();
        skip();
        if (src[i] === '}') {
          advance();
          return node;
        }
        continue;
      }
      if (src[i] === '}') {
        advance();
        return node;
      }
      fail(`Expected , or } but found ${describe(src[i])}`);
    }
  };

  try {
    skip();
    if (i >= src.length) return { root: objectNode(), duplicates, errors: [] };
    if (src[i] !== '{') fail('A locale file must contain a JSON object');
    const root = parseObject([]);
    skip();
    if (i < src.length) fail(`Unexpected ${describe(src[i])} after the end of the object`);
    return { root, duplicates, errors: [] };
  } catch (err) {
    if (err instanceof JsonSyntaxError) {
      return {
        root: objectNode(),
        duplicates,
        errors: [{ message: err.message, line: err.line, column: err.column }],
      };
    }
    throw err;
  }
}

function toPlainObject(node: ObjectNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of node.children) out[k] = v.kind === 'leaf' ? v.value : toPlainObject(v);
  return out;
}

function describe(c: string | undefined): string {
  if (c === undefined) return 'end of file';
  if (c === '\n') return 'a line break';
  return `"${c}"`;
}

/** Indentation and layout details, so rewritten files look like the original. */
export interface JsonStyle {
  indent: string;
  finalNewline: boolean;
}

export function detectJsonStyle(text: string): JsonStyle {
  const m = /\n([ \t]+)"/.exec(text);
  return { indent: m ? m[1]! : '  ', finalNewline: text.endsWith('\n') || text === '' };
}

/**
 * Serializes a tree as JSON, keeping key order exactly (plain objects would
 * move integer-like keys to the front). Non-ASCII text such as Bangla is
 * written as is.
 */
export function stringifyJsonTree(
  root: ObjectNode,
  style: JsonStyle = { indent: '  ', finalNewline: true },
): string {
  const text = writeNode(root, style.indent, '');
  return style.finalNewline ? `${text}\n` : text;
}

function writeNode(node: TreeNode, indent: string, current: string): string {
  if (node.kind === 'leaf') {
    const json = JSON.stringify(node.value, null, indent) ?? 'null';
    return json.replace(/\n/g, `\n${current}`);
  }
  if (node.children.size === 0) return '{}';
  const inner = current + indent;
  const parts = [...node.children].map(
    ([k, v]) => `${inner}${JSON.stringify(k)}: ${writeNode(v, indent, inner)}`,
  );
  return `{\n${parts.join(',\n')}\n${current}}`;
}
