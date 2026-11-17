import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  leaves,
  parseJsonTree,
  parsePo,
  parsePoTree,
  parseYamlTree,
  stringifyJsonTree,
  stringifyYamlTree,
} from '../src/index.js';
import { toPlain } from '../src/locales/tree.js';

const flat = (tree: ReturnType<typeof parseJsonTree>) =>
  Object.fromEntries([...leaves(tree.root)].map((l) => [l.path.join('.'), l.node.value]));

describe('JSON', () => {
  it('keeps order, lines and nesting', () => {
    const t = parseJsonTree('{\n  "b": "1",\n  "a": {\n    "x": "2",\n    "y": [1, 2]\n  },\n  "n": 3\n}');
    assert.deepEqual(flat(t), { b: '1', 'a.x': '2', 'a.y': [1, 2], n: 3 });
    assert.deepEqual(
      [...leaves(t.root)].map((l) => l.node.line),
      [2, 4, 5, 7],
    );
    assert.equal(t.errors.length, 0);
  });

  it('reports duplicate keys that JSON.parse would hide', () => {
    const t = parseJsonTree('{"a": "1", "nested": {"k": 1, "k": 2}, "a": "2"}');
    assert.deepEqual(
      t.duplicates.map((d) => d.path.join('.')),
      ['nested.k', 'a'],
    );
    assert.equal(flat(t).a, '2');
  });

  it('accepts comments and trailing commas', () => {
    const t = parseJsonTree('{\n // note\n "a": "x", /* c */\n "b": ["y",],\n}');
    assert.deepEqual(flat(t), { a: 'x', b: ['y'] });
    assert.equal(t.errors.length, 0);
  });

  it('decodes escapes and keeps Unicode', () => {
    const t = parseJsonTree('{"a": "line\\n\\"q\\" \\u09AC", "bn": "বাংলা"}');
    assert.equal(flat(t).a, 'line\n"q" ব');
    assert.equal(flat(t).bn, 'বাংলা');
  });

  it('reports syntax errors with a position', () => {
    const t = parseJsonTree('{\n  "a": "x"\n  "b": "y"\n}');
    assert.equal(t.errors.length, 1);
    assert.equal(t.errors[0]!.line, 3);
    assert.match(t.errors[0]!.message, /Expected , or \}/);
    assert.match(parseJsonTree('["a"]').errors[0]!.message, /JSON object/);
    assert.match(parseJsonTree('{"a": "x').errors[0]!.message, /Unterminated string/);
    assert.equal(parseJsonTree('').errors.length, 0);
  });

  it('writes with the same indentation and key order, including integer-like keys', () => {
    const text =
      '{\n    "b": "বাংলা",\n    "10": "ten",\n    "a": {\n        "x": [1, 2]\n    },\n    "e": {}\n}\n';
    const t = parseJsonTree(text);
    const out = stringifyJsonTree(t.root, { indent: '    ', finalNewline: true });
    assert.equal(out, text.replace('[1, 2]', '[\n            1,\n            2\n        ]'));
    assert.deepEqual(Object.keys(JSON.parse(out)).length, 4);
    assert.ok(out.indexOf('"b"') < out.indexOf('"10"'));
  });
});

describe('YAML subset', () => {
  it('reads nested maps, quotes, comments and Unicode', () => {
    const t = parseYamlTree(
      [
        '# top comment',
        '---',
        'app:',
        '  title: My app # trailing comment',
        '  hash: "#not a comment"',
        "  single: 'it''s'",
        '  double: "tab\\tnew\\nline"',
        '  "quoted key": yes',
        '  bn: স্বাগতম',
        '  empty:',
        'other: value',
      ].join('\n'),
    );
    assert.deepEqual(t.errors, []);
    assert.deepEqual(toPlain(t.root), {
      app: {
        title: 'My app',
        hash: '#not a comment',
        single: "it's",
        double: 'tab\tnew\nline',
        'quoted key': 'yes',
        bn: 'স্বাগতম',
        empty: '',
      },
      other: 'value',
    });
    assert.equal([...leaves(t.root)][0]!.node.line, 4);
  });

  it('reads block scalars with chomping', () => {
    const t = parseYamlTree(
      'a: |\n  one\n  two\n\nb: |-\n  keep\n  lines\nc: >\n  folded\n  text\n\n  para\nd: x\n',
    );
    const v = toPlain(t.root) as Record<string, string>;
    assert.equal(v.a, 'one\ntwo\n');
    assert.equal(v.b, 'keep\nlines');
    assert.equal(v.c, 'folded text\npara\n');
    assert.equal(v.d, 'x');
  });

  it('reads sequences, flow sequences and multi-line quoted scalars', () => {
    const t = parseYamlTree(
      'days:\n  - Mon\n  - "Tue"\nshort: [a, "b c"]\nlong: "first\n  second"\nafter: 1\n',
    );
    assert.deepEqual(toPlain(t.root), {
      days: ['Mon', 'Tue'],
      short: ['a', 'b c'],
      long: 'first second',
      after: '1',
    });
  });

  it('reports duplicates and unsupported syntax', () => {
    const t = parseYamlTree('a: 1\nb:\n  c: 2\n  c: 3\na: 4\nanchor: &x hi\nflow: { a: 1 }\n\tbad: tab\n');
    assert.deepEqual(
      t.duplicates.map((d) => [d.path.join('.'), d.line, d.firstLine]),
      [
        ['b.c', 4, 3],
        ['a', 5, 1],
      ],
    );
    assert.deepEqual(
      t.errors.map((e) => e.line),
      [6, 7, 8],
    );
  });

  it('round-trips through the writer', () => {
    const src = {
      app: { title: 'My shop', greeting: 'Hello, {name}!', colon: 'Total: {n}', yes: 'yes', num: '42' },
      about: 'line one\nline two\n',
      strip: 'a\nb',
      list: ['x', 'y z'],
      bn: 'আমার দোকান',
      empty: '',
      'key with spaces': 'v',
    };
    const t = parseYamlTree(
      JSON.stringify(src).length > 0 ? stringifyYamlTree(parseJsonTree(JSON.stringify(src)).root) : '',
    );
    assert.deepEqual(t.errors, []);
    assert.deepEqual(toPlain(t.root), src);
  });
});

describe('PO', () => {
  const po = [
    '# translator comment',
    'msgid ""',
    'msgstr ""',
    '"Language: bn\\n"',
    '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"',
    '',
    'msgid "Hello %s"',
    'msgstr "হ্যালো %s"',
    '',
    '#, fuzzy',
    'msgctxt "menu"',
    'msgid "Open"',
    'msgstr "খুলুন"',
    '',
    'msgid ""',
    '"multi "',
    '"line"',
    'msgstr "বহু লাইন"',
    'msgid "One file"',
    'msgid_plural "%d files"',
    'msgstr[0] "একটি ফাইল"',
    'msgstr[1] "%dটি ফাইল"',
    '',
    '#~ msgid "Obsolete"',
    '#~ msgstr "x"',
  ].join('\n');

  it('reads headers, contexts, fuzzy flags, multi-line strings and plurals', () => {
    const r = parsePo(po);
    assert.equal(r.headers.Language, 'bn');
    assert.deepEqual(
      r.entries.map((e) => [e.context, e.id, e.strings, e.fuzzy]),
      [
        [undefined, 'Hello %s', ['হ্যালো %s'], false],
        ['menu', 'Open', ['খুলুন'], true],
        [undefined, 'multi line', ['বহু লাইন'], false],
        [undefined, 'One file', ['একটি ফাইল', '%dটি ফাইল'], false],
      ],
    );
    assert.equal(r.entries[3]!.plural, '%d files');
    assert.equal(r.errors.length, 0);
  });

  it('as a tree: fuzzy entries count as empty, the base uses msgid', () => {
    const t = parsePoTree(po);
    assert.deepEqual(toPlain(t.root), {
      'Hello %s': 'হ্যালো %s',
      'menu|Open': '',
      'multi line': 'বহু লাইন',
      'One file': 'একটি ফাইল',
    });
    const base = parsePoTree('msgid "Save"\nmsgstr ""\n', true);
    assert.deepEqual(toPlain(base.root), { Save: 'Save' });
  });

  it('reports bad lines', () => {
    assert.equal(parsePo('msgid "a"\nmsgstr "b"\nnonsense\n').errors[0]!.line, 3);
  });
});
