import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { analyze, applyFixes, planFixes, VERSION } from '../src/index.js';
import { cli, copyFixture, fixture, project } from './helpers.js';

const json = (cwd: string, file: string) => JSON.parse(readFileSync(join(cwd, file), 'utf8'));

describe('cli: check', () => {
  it('help, version, lists', async () => {
    const cwd = fixture('react-i18next');
    assert.match((await cli(cwd, ['--help'])).stdout, /Usage:/);
    assert.equal((await cli(cwd, ['-v'])).stdout, `${VERSION}\n`);
    const rules = (await cli(cwd, ['--list-rules'])).stdout;
    assert.match(rules, /^parse-error\s+error/m);
    assert.match(rules, /untranslated\s+info/);
    assert.match((await cli(cwd, ['--list-extractors'])).stdout, /next-intl\s+next-intl/);
  });

  it('pretty output with a coverage table and exit code 1 on errors', async () => {
    const r = await cli(fixture('react-i18next'), []);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Base locale en · i18next · i18next placeholders/);
    assert.match(r.stdout, /bn\s+13\s+2\s+1\s+78\.5%/);
    assert.match(r.stdout, /error missing-key \(5\)/);
    assert.match(r.stdout, /✖ 7 errors, 5 warnings, 4 info · 3 locales, 14 keys, 2 source files/);
  });

  it('--min-severity hides details but not the summary', async () => {
    const r = await cli(fixture('react-i18next'), ['--min-severity', 'error']);
    assert.ok(!r.stdout.includes('unused-key'));
    assert.match(r.stdout, /5 warnings/);
  });

  it('--fail-on', async () => {
    const cwd = fixture('angular');
    assert.equal((await cli(cwd, ['--rule', 'undefined-key=warning'])).code, 0);
    assert.equal((await cli(cwd, ['--rule', 'undefined-key=warning', '--fail-on', 'warning'])).code, 1);
    assert.equal((await cli(cwd, ['--fail-on', 'none'])).code, 0);
    assert.equal((await cli(cwd, ['--only', 'dynamic-key', '--fail-on', 'info'])).code, 1);
  });

  it('JSON output', async () => {
    const r = await cli(fixture('next-intl'), ['--format', 'json']);
    const data = JSON.parse(r.stdout);
    assert.equal(data.baseLocale, 'en');
    assert.deepEqual(data.extractors, ['next-intl']);
    assert.equal(data.summary.error, 2);
    assert.equal(data.issues[0].rule, 'undefined-key');
  });

  it('GitHub annotations', async () => {
    const r = await cli(fixture('vue-i18n'), ['--format', 'github']);
    const lines = r.stdout.trim().split('\n');
    assert.ok(
      lines.includes(
        '::error file=src/components/Cart.vue,line=19,col=19,title=i18n-check undefined-key::cart.discount is used but not defined in any locale',
      ),
    );
    assert.ok(lines.some((l) => l.startsWith('::notice file=src/components/Cart.vue,line=10')));
    assert.match(lines.at(-1)!, /3 errors/);
  });

  it('Markdown output and --output appends to a file', async () => {
    const out = join(project({}), 'summary.md');
    const r = await cli(fixture('react-intl'), ['--format', 'markdown', '--output', out]);
    assert.match(r.stdout, /^## Translation check/);
    assert.match(r.stdout, /\| bn \| 3 \| 1 \| 0 \| 75\.0% \|/);
    assert.match(r.stdout, /<summary><b>missing-key<\/b> \(1, error\)<\/summary>/);
    assert.equal(readFileSync(out, 'utf8'), r.stdout);
    // Pretty output to the terminal, Markdown to the file.
    await cli(fixture('react-intl'), ['--output', out]);
    assert.match(readFileSync(out, 'utf8'), /## Translation check[\s\S]*## Translation check/);
  });

  it('flags override locales, base, sources and extractors', async () => {
    const r = await cli(fixture('generic'), [
      '--functions',
      '__',
      '--format',
      'json',
      '--base',
      'bn',
      '--no-source',
    ]);
    const data = JSON.parse(r.stdout);
    assert.equal(data.baseLocale, 'bn');
    assert.equal(data.sourceFiles, undefined);
    const ext = await cli(fixture('react-i18next'), ['--extractor', 'generic', '--format', 'json']);
    assert.deepEqual(JSON.parse(ext.stdout).extractors, ['generic']);
    const loc = await cli(fixture('react-i18next'), [
      '--locales',
      'public/locales/{locale}/common.json',
      '--format',
      'json',
    ]);
    assert.equal(JSON.parse(loc.stdout).files.length, 3);
  });

  it('reads i18n-check.config.json', async () => {
    const cwd = project({
      'i18n/en.json': '{"a": "A", "b": "B"}',
      'i18n/bn.json': '{"a": "A"}',
      'i18n-check.config.json': JSON.stringify({
        locales: 'i18n/{locale}.json',
        rules: { 'missing-key': 'warning' },
        ignoreUntranslated: ['a'],
      }),
      'src/a.js': "t('a'); t('b');",
    });
    const r = await cli(cwd, ['--format', 'json']);
    assert.equal(r.code, 0);
    const data = JSON.parse(r.stdout);
    assert.deepEqual(
      data.issues.map((i: { rule: string; severity: string }) => `${i.rule}:${i.severity}`),
      ['missing-key:warning'],
    );
  });

  it('usage and configuration errors exit 2', async () => {
    const cwd = fixture('react-i18next');
    assert.equal((await cli(cwd, ['--format', 'xml'])).code, 2);
    assert.equal((await cli(cwd, ['--nope'])).code, 2);
    assert.equal((await cli(cwd, ['launch'])).code, 2);
    assert.match((await cli(cwd, ['--rule', 'bad'])).stderr, /--rule must look like/);
    assert.match((await cli(cwd, ['--extractor', 'nope'])).stderr, /Unknown extractor "nope"/);
    assert.match((await cli(project({}), [])).stderr, /No locale files found/);
    const bad = project({ 'i18n-check.config.json': '{"locale": "x"}' });
    assert.match((await cli(bad, [])).stderr, /unknown option "locale"/);
  });
});

describe('cli: extract', () => {
  it('lists used keys', async () => {
    const r = await cli(fixture('next-intl'), ['extract']);
    assert.deepEqual(r.stdout.trim().split('\n'), [
      'About.missing',
      'About.since',
      'About.title',
      'Home.cart',
      'Home.rank',
      'Home.terms',
      'Home.title',
    ]);
    assert.match(r.stderr, /7 keys, 0 dynamic keys in 2 files/);
    const j = JSON.parse((await cli(fixture('vue-i18n'), ['extract', '--format', 'json'])).stdout);
    assert.equal(j.keys['app.title'][0].line, 4);
    assert.equal(j.dynamic.length, 1);
  });
});

describe('fix', () => {
  it('adds missing keys with the base text and sorts (default)', async () => {
    const cwd = copyFixture('react-i18next');
    const r = await cli(cwd, ['fix']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /create public\/locales\/ar\/auth\.json {2}\+3/);
    assert.match(r.stdout, /Changed 5 files: 5 keys added, 0 removed/);
    assert.deepEqual(json(cwd, 'public/locales/ar/auth.json'), {
      login: { button: 'Sign in', error: 'Wrong email or password' },
      logout: 'Sign out',
    });
    const bn = json(cwd, 'public/locales/bn/common.json');
    assert.equal(bn.legacy, 'Old banner');
    assert.deepEqual(Object.keys(bn), [...Object.keys(bn)].sort());
    // Plural forms that Bangla does not need are not added; nothing is missing now.
    const after = await cli(cwd, ['--only', 'missing-key']);
    assert.equal(after.code, 0, after.stdout);
  });

  it('--dry-run writes nothing; --fill empty and key', async () => {
    const cwd = copyFixture('react-intl');
    const before = readFileSync(join(cwd, 'src/lang/bn.json'), 'utf8');
    const dry = await cli(cwd, ['fix', '--dry-run', '--add-missing']);
    assert.match(dry.stdout, /\+ app\.unused/);
    assert.match(dry.stdout, /Dry run: would change 2 files: 1 key added/);
    assert.equal(readFileSync(join(cwd, 'src/lang/bn.json'), 'utf8'), before);
    await cli(cwd, ['fix', '--add-missing', '--fill', 'empty', '--no-sort']);
    const bn = json(cwd, 'src/lang/bn.json');
    assert.equal(bn['app.unused'], '');
    assert.deepEqual(Object.keys(bn), ['app.title', 'app.greeting', 'app.logout', 'app.unused']);
    const cwd2 = copyFixture('react-intl');
    await cli(cwd2, ['fix', '--add-missing', '--fill', 'key']);
    assert.equal(json(cwd2, 'src/lang/bn.json')['app.unused'], 'app.unused');
  });

  it('--remove-unused and --remove-extra', async () => {
    const cwd = copyFixture('react-i18next');
    const r = await cli(cwd, ['fix', '--remove-unused', '--remove-extra']);
    assert.match(r.stdout, /0 keys added, 6 removed/);
    for (const l of ['en', 'bn', 'ar']) {
      const common = json(cwd, `public/locales/${l}/common.json`);
      assert.equal(common.legacy, undefined);
      assert.equal(common.brand, undefined);
      assert.equal(common.oldKey, undefined);
    }
    // Arabic plural forms beyond the base are kept.
    assert.ok(json(cwd, 'public/locales/ar/common.json').items_few);
    // A key removed as unused is not added back to other locales.
    const both = copyFixture('react-i18next');
    await cli(both, ['fix', '--remove-unused', '--add-missing']);
    assert.equal(json(both, 'public/locales/bn/common.json').legacy, undefined);
  });

  it('keeps YAML readable and Rails roots', async () => {
    const cwd = copyFixture('vue-i18n');
    await cli(cwd, ['fix']);
    const text = readFileSync(join(cwd, 'src/locales/bn.yaml'), 'utf8');
    assert.match(text, /^about: \|\n {2}আমরা জিনিস বিক্রি করি।\n {2}২০২০ সাল থেকে।\n/);
    assert.match(text, /\n {2}checkout: "@:app\.title checkout"\n/);
    assert.match(text, /\n {2}total: "মোট: \{amount\}"\n/);
    const rails = project({
      'config/locales/en.yml': 'en:\n  b: B\n  a: A\n',
      'config/locales/bn.yml': 'bn:\n  a: এ\n',
    });
    await cli(rails, ['fix', '--locales', 'config/locales/{locale}.yml', '--no-source']);
    assert.equal(readFileSync(join(rails, 'config/locales/bn.yml'), 'utf8'), 'bn:\n  a: এ\n  b: B\n');
  });

  it('does not touch .po files or files with syntax errors', async () => {
    const cwd = copyFixture('gettext');
    const r = await cli(cwd, ['fix', '--extractor', 'generic', '--functions', '_']);
    assert.equal(r.code, 0);
    const bad = project({ 'locales/en.json': '{"a":"A","b":"B"}', 'locales/bn.json': '{"a": }' });
    const res = analyze({ cwd: bad, noSource: true });
    const changes = planFixes(res, { addMissing: true }, bad);
    assert.equal(changes[0]!.skipped, 'the file has syntax errors');
    applyFixes(changes, bad);
    assert.equal(readFileSync(join(bad, 'locales/bn.json'), 'utf8'), '{"a": }');
  });

  it('creates files for new namespaces next to the base', async () => {
    const cwd = project({
      'locales/en/common.json': '{"a":"A"}',
      'locales/en/admin.json': '{"x":"X"}',
      'locales/bn/common.json': '{"a":"এ"}',
    });
    await cli(cwd, ['fix', '--no-source']);
    assert.ok(existsSync(join(cwd, 'locales/bn/admin.json')));
    assert.deepEqual(json(cwd, 'locales/bn/admin.json'), { x: 'X' });
  });
});
