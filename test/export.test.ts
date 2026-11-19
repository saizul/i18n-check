import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { analyze, collectTasks, formatTasks, TASK_RULES, tasksToCsv, tasksToXliff } from '../src/index.js';
import { cli, fixture, project } from './helpers.js';

const files = () =>
  project({
    'locales/en.json': JSON.stringify({
      greeting: 'Hello, {name}!',
      bye: 'Goodbye',
      cart: { empty: 'Your cart is empty', total: 'Total: "{amount}"' },
      formula: '=SUM(A1)',
      brand: 'Acme',
    }),
    'locales/bn.json': JSON.stringify({
      greeting: 'হ্যালো, {name}!',
      bye: '',
      cart: { empty: 'Your cart is empty' },
      brand: 'Acme',
    }),
    'locales/de.json': JSON.stringify({ greeting: 'Hallo, {name}!', bye: 'Tschüss' }),
  });

function tasksFor(cwd: string, include?: Parameters<typeof collectTasks>[1]) {
  const result = analyze({ cwd, noSource: true, only: [...TASK_RULES] });
  return collectTasks(result, include);
}

describe('collectTasks', () => {
  it('lists missing, empty and untranslated strings per locale, without the base locale', () => {
    const tasks = tasksFor(files());
    const bn = tasks.filter((t) => t.locale === 'bn').map((t) => [t.key, t.reason, t.target]);
    assert.deepEqual(bn, [
      ['brand', 'untranslated', 'Acme'],
      ['bye', 'empty', ''],
      ['cart.empty', 'untranslated', 'Your cart is empty'],
      ['cart.total', 'missing', ''],
      ['formula', 'missing', ''],
    ]);
    // Brand names are listed as untranslated unless ignoreUntranslated covers them.
    const ignored = analyze({
      cwd: files(),
      noSource: true,
      only: [...TASK_RULES],
      ignoreUntranslated: ['brand'],
    });
    assert.ok(!collectTasks(ignored).some((t) => t.key === 'brand' && t.locale === 'bn'));
    assert.deepEqual(
      tasks.filter((t) => t.locale === 'de').map((t) => t.key),
      ['brand', 'cart.empty', 'cart.total', 'formula'],
    );
    assert.ok(!tasks.some((t) => t.locale === 'en'));
    assert.equal(tasks.find((t) => t.key === 'cart.total')!.source, 'Total: "{amount}"');
  });

  it('filters by reason and follows rules turned off', () => {
    const cwd = files();
    assert.deepEqual(
      tasksFor(cwd, ['empty']).map((t) => `${t.locale}:${t.key}`),
      ['bn:bye'],
    );
    const result = analyze({ cwd, noSource: true, only: [...TASK_RULES], rules: { untranslated: 'off' } });
    assert.ok(!collectTasks(result).some((t) => t.reason === 'untranslated'));
  });
});

describe('export formats', () => {
  const tasks = [
    { locale: 'bn', key: 'a', source: 'Say "hi", then go', target: '', reason: 'missing' as const },
    { locale: 'bn', key: 'b', source: '=1+1', target: '', reason: 'empty' as const },
    {
      locale: 'de',
      key: 'x<y>&"z"',
      source: 'Line 1\nLine 2 <b>&</b>',
      target: 'T',
      reason: 'untranslated' as const,
    },
  ];

  it('writes CSV with quoting and formula protection', () => {
    const csv = tasksToCsv(tasks);
    const lines = csv.split('\r\n');
    assert.equal(lines[0], 'locale,key,source,target,reason');
    assert.equal(lines[1], 'bn,a,"Say ""hi"", then go",,missing');
    assert.equal(lines[2], "bn,b,'=1+1,,empty");
    assert.ok(csv.includes('"Line 1\nLine 2 <b>&</b>"'));
    assert.ok(csv.endsWith('\r\n'));
  });

  it('writes XLIFF 1.2 with one file per locale and escaped text', () => {
    const xliff = tasksToXliff(tasks, 'en');
    assert.ok(xliff.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<xliff version="1.2"'));
    assert.equal(xliff.match(/<file /g)?.length, 2);
    assert.match(xliff, /source-language="en" target-language="bn"/);
    assert.match(
      xliff,
      /<trans-unit id="x&lt;y&gt;&amp;&quot;z&quot;" resname="x&lt;y&gt;&amp;&quot;z&quot;"/,
    );
    assert.match(xliff, /<source>Line 1\nLine 2 &lt;b&gt;&amp;&lt;\/b&gt;<\/source>/);
    assert.match(xliff, /<target state="needs-translation">T<\/target>/);
    assert.match(xliff, /<note>untranslated<\/note>/);
    assert.equal(formatTasks([], 'xliff', 'en').match(/<file /g), null);
  });

  it('writes JSON', () => {
    const data = JSON.parse(formatTasks(tasks, 'json', 'en'));
    assert.equal(data.sourceLanguage, 'en');
    assert.equal(data.tasks.length, 3);
    assert.throws(() => formatTasks(tasks, 'po' as 'csv', 'en'), /format must be/);
  });
});

describe('cli: export', () => {
  it('prints CSV by default with a summary on stderr', async () => {
    const r = await cli(files(), ['export']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^locale,key,source,target,reason\r\n/);
    assert.match(r.stdout, /bn,cart\.total,"Total: ""\{amount\}""",,missing/);
    assert.equal(r.stderr, '9 strings to translate in 2 locales\n');
  });

  it('writes XLIFF to a file for selected locales and reasons', async () => {
    const cwd = files();
    const r = await cli(cwd, [
      'export',
      '--format',
      'xliff',
      '--only-locales',
      'bn',
      '--include',
      'missing,empty',
      '--output',
      'out/bn.xlf',
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'Wrote out/bn.xlf: 3 strings to translate in 1 locale\n');
    const xliff = readFileSync(join(cwd, 'out/bn.xlf'), 'utf8');
    assert.match(xliff, /target-language="bn"/);
    assert.doesNotMatch(xliff, /target-language="de"|cart\.empty/);
  });

  it('works on a namespaced fixture and rejects bad options', async () => {
    const r = await cli(fixture('react-i18next'), ['export', '--format', 'json']);
    assert.equal(r.code, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.ok(data.tasks.some((t: { key: string; namespace?: string }) => t.namespace === 'auth'));
    assert.equal((await cli(files(), ['export', '--format', 'markdown'])).code, 2);
    const bad = await cli(files(), ['export', '--include', 'missing,stale']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /--include takes missing, empty, untranslated/);
  });
});
