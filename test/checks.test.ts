import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyze,
  type Check,
  discoverLocaleFiles,
  type Issue,
  loadCatalog,
  patternToRegExp,
  registerCheck,
} from '../src/index.js';
import { fixture, project } from './helpers.js';

const byRule = (issues: Issue[]) => {
  const out: Record<string, string[]> = {};
  for (const i of issues) {
    out[i.rule] ??= [];
    out[i.rule]!.push(`${i.locale ?? '-'} ${i.key ?? i.message}`);
  }
  return out;
};

describe('discovery and catalog', () => {
  it('detects namespaced layouts', () => {
    const refs = discoverLocaleFiles(fixture('react-i18next'));
    assert.deepEqual(
      refs.map((r) => [r.path, r.locale, r.namespace]),
      [
        ['public/locales/ar/common.json', 'ar', 'common'],
        ['public/locales/bn/auth.json', 'bn', 'auth'],
        ['public/locales/bn/common.json', 'bn', 'common'],
        ['public/locales/en/auth.json', 'en', 'auth'],
        ['public/locales/en/common.json', 'en', 'common'],
      ],
    );
  });

  it('detects single-file layouts in yaml, json and po', () => {
    assert.deepEqual(
      discoverLocaleFiles(fixture('vue-i18n')).map((r) => r.path),
      ['src/locales/bn.yaml', 'src/locales/en.yaml'],
    );
    assert.deepEqual(
      discoverLocaleFiles(fixture('next-intl')).map((r) => r.locale),
      ['bn', 'en'],
    );
    assert.deepEqual(
      discoverLocaleFiles(fixture('gettext')).map((r) => [r.locale, r.namespace, r.format]),
      [
        ['bn', 'messages', 'po'],
        ['en', 'messages', 'po'],
      ],
    );
  });

  it('patterns accept region codes and globs', () => {
    const re = patternToRegExp('**/i18n/{locale}.{ext}');
    for (const p of [
      'i18n/bn-BD.json',
      'apps/web/i18n/pt_BR.yaml',
      'i18n/zh-Hant-TW.json',
      'i18n/es-419.json',
    ])
      assert.ok(re.test(p), p);
    assert.ok(!re.test('i18n/index.json'));
  });

  it('picks the base locale and indexes keys', () => {
    const c = loadCatalog({ cwd: fixture('react-i18next') });
    assert.equal(c.baseLocale, 'en');
    assert.deepEqual(c.locales, ['en', 'ar', 'bn']);
    assert.equal(c.hasNamespaces, true);
    assert.deepEqual(c.namespaces, ['auth', 'common']);
    const e = c.entries.get('bn')!.get('common:status.active')!;
    assert.equal(e.text, 'সক্রিয়');
    assert.equal(e.line, 7);
    assert.deepEqual(e.path, ['status', 'active']);
  });

  it('chooses the locale with most keys when there is no English', () => {
    const cwd = project({
      'locales/bn.json': '{"a":"১","b":"২"}',
      'locales/hi.json': '{"a":"१"}',
    });
    assert.equal(loadCatalog({ cwd }).baseLocale, 'bn');
  });

  it('unwraps Rails-style YAML and reports nested/flat conflicts', () => {
    const cwd = project({
      'config/locales/en.yml': 'en:\n  hello: Hello\n',
      'config/locales/bn.yml': 'bn:\n  hello: হ্যালো\n',
      'messages/en.json': '{"a": "x", "a.b": "y"}',
    });
    const c = loadCatalog({ cwd, patterns: ['config/locales/{locale}.yml'] });
    assert.equal(c.entries.get('bn')!.get('hello')!.text, 'হ্যালো');
    assert.equal(c.files[0]!.style.rootKey, 'bn');
    const flat = loadCatalog({ cwd, patterns: ['messages/{locale}.json'] });
    assert.match(flat.conflicts[0]!.message, /nested under "a"/);
  });

  it('explains when nothing is found', () => {
    assert.throws(() => loadCatalog({ cwd: project({ 'src/a.js': '' }) }), /No locale files found/);
    assert.throws(
      () => loadCatalog({ cwd: fixture('vue-i18n'), baseLocale: 'fr' }),
      /Base locale "fr" has no files/,
    );
  });
});

describe('checks on the react-i18next fixture', () => {
  const r = analyze({ cwd: fixture('react-i18next') });
  const rules = byRule(r.issues);

  it('finds missing keys per locale, without plural forms the locale does not need', () => {
    assert.deepEqual(rules['missing-key'], [
      'ar auth:login.button',
      'ar auth:login.error',
      'ar auth:logout',
      'bn auth:logout',
      'bn common:legacy',
    ]);
  });

  it('finds keys used in code but missing everywhere', () => {
    assert.deepEqual(rules['undefined-key'], ['- common:missing.in.base']);
    const i = r.issues.find((x) => x.rule === 'undefined-key')!;
    assert.equal(i.file, 'src/App.tsx');
    assert.equal(i.line, 15);
  });

  it('finds placeholder mismatches, but lets singular forms drop {{count}}', () => {
    assert.deepEqual(rules['placeholder-mismatch'], ['ar common:title']);
    assert.match(
      r.issues.find((x) => x.rule === 'placeholder-mismatch')!.message,
      /lacks \{\{name\}\} and adds \{\{user\}\}/,
    );
  });

  it('checks plural forms with CLDR categories (Arabic needs six)', () => {
    assert.deepEqual(rules['plural-forms'], ['ar common:items']);
    const pluralMsg = r.issues.find((x) => x.rule === 'plural-forms')!.message;
    for (const form of ['_zero', '_two', '_many']) assert.ok(pluralMsg.includes(form), form);
  });

  it('finds unused, extra, empty, untranslated and dynamic keys', () => {
    assert.deepEqual(rules['unused-key'], ['en common:legacy', 'en common:brand']);
    assert.deepEqual(rules['extra-key'], ['bn common:oldKey']);
    assert.deepEqual(rules['empty-value'], ['bn common:status.blocked']);
    assert.deepEqual(rules.untranslated, ['ar common:brand', 'bn common:nav.settings', 'bn common:brand']);
    assert.equal(rules['dynamic-key']!.length, 1);
  });

  it('counts $t() nesting, dynamic prefixes and plural stems as usage', () => {
    assert.ok(r.context.isUsed('common:nav.home'));
    assert.ok(r.context.isUsed('common:status.blocked'));
    assert.ok(r.context.isUsed('common:items_one'));
    assert.ok(!r.context.isUsed('common:legacy'));
  });

  it('computes coverage', () => {
    assert.deepEqual(
      r.stats.map((s) => [s.locale, s.missing, s.empty, s.coverage]),
      [
        ['en', 0, 0, 100],
        ['ar', 3, 0, 78.5],
        ['bn', 2, 1, 78.5],
      ],
    );
  });
});

describe('checks on the other fixtures', () => {
  it('vue-i18n: YAML, linked messages, v-t and pipes', () => {
    const rules = byRule(analyze({ cwd: fixture('vue-i18n') }).issues);
    assert.deepEqual(rules['missing-key'], ['bn cart.checkout']);
    assert.deepEqual(rules['undefined-key'], ['- cart.discount']);
    assert.deepEqual(rules['placeholder-mismatch'], ['bn app.greeting']);
    assert.deepEqual(rules['unused-key'], ['en unused']);
  });

  it('next-intl: ICU syntax and Bangla plural rules', () => {
    const r = analyze({ cwd: fixture('next-intl') });
    const rules = byRule(r.issues);
    assert.equal(r.messageFormat, 'icu');
    assert.deepEqual(rules['icu-syntax'], ['bn About.since']);
    assert.deepEqual(rules['plural-forms'], ['bn Home.cart', 'bn Home.rank']);
    assert.deepEqual(rules['undefined-key'], ['- About.missing']);
    assert.deepEqual(rules['unused-key'], ['en Unused.old']);
    assert.equal(rules['placeholder-mismatch'], undefined);
  });

  it('react-intl: flat ids', () => {
    const rules = byRule(analyze({ cwd: fixture('react-intl') }).issues);
    assert.deepEqual(rules['missing-key'], ['bn app.unused']);
    assert.deepEqual(rules['undefined-key'], ['- app.notDefined']);
    assert.deepEqual(rules['unused-key'], ['en app.unused']);
    assert.deepEqual(rules.untranslated, ['bn app.logout']);
  });

  it('ngx-translate: templates and the service', () => {
    const rules = byRule(analyze({ cwd: fixture('angular') }).issues);
    assert.deepEqual(rules['undefined-key'], ['- HOME.MISSING']);
    assert.deepEqual(rules['unused-key'], ['en UNUSED']);
    assert.equal(rules['placeholder-mismatch'], undefined);
  });

  it('generic: custom functions and printf placeholders', () => {
    const rules = byRule(
      analyze({ cwd: fixture('generic'), functions: ['__'], messageFormat: 'printf' }).issues,
    );
    assert.deepEqual(rules['placeholder-mismatch'], ['bn named']);
    assert.deepEqual(rules['unused-key'], ['en bye']);
  });

  it('gettext: fuzzy entries are empty, msgid is the base text', () => {
    const r = analyze({ cwd: fixture('gettext'), functions: ['_'], extractors: ['generic'] });
    const rules = byRule(r.issues);
    assert.deepEqual(rules['empty-value'], ['bn messages:menu|Open']);
    assert.equal(r.catalog.entries.get('en')!.get('messages:Hello %s')!.text, 'Hello %s');
    assert.ok(!rules['unused-key']!.includes('en messages:Hello %s'));
  });
});

describe('configuration', () => {
  it('rules can be turned off or changed', () => {
    const r = analyze({
      cwd: fixture('react-i18next'),
      rules: { 'unused-key': 'off', untranslated: 'warning', 'missing-key': 'info' },
    });
    const rules = byRule(r.issues);
    assert.equal(rules['unused-key'], undefined);
    assert.ok(r.issues.filter((i) => i.rule === 'untranslated').every((i) => i.severity === 'warning'));
    assert.ok(r.issues.filter((i) => i.rule === 'missing-key').every((i) => i.severity === 'info'));
    assert.throws(
      () => analyze({ cwd: fixture('react-i18next'), rules: { nope: 'off' } }),
      /Unknown rule: nope/,
    );
  });

  it('ignore lists', () => {
    const r = analyze({
      cwd: fixture('react-i18next'),
      ignoreKeys: ['auth:*'],
      ignoreUnused: ['common:legacy'],
      ignoreUntranslated: ['common:brand'],
    });
    const rules = byRule(r.issues);
    assert.deepEqual(rules['missing-key'], ['bn common:legacy']);
    assert.deepEqual(rules['unused-key'], ['en common:brand']);
    assert.deepEqual(rules.untranslated, ['bn common:nav.settings']);
  });

  it('only, onlyLocales, noSource and dynamicPrefixAsUsed', () => {
    const only = analyze({ cwd: fixture('react-i18next'), only: ['missing-key'], onlyLocales: ['bn'] });
    assert.deepEqual(byRule(only.issues), { 'missing-key': ['bn auth:logout', 'bn common:legacy'] });
    assert.deepEqual(only.catalog.locales, ['en', 'bn']);
    const noSrc = analyze({ cwd: fixture('react-i18next'), noSource: true });
    assert.equal(noSrc.usage, undefined);
    assert.ok(!noSrc.issues.some((i) => i.rule === 'unused-key' || i.rule === 'undefined-key'));
    const strict = analyze({ cwd: fixture('react-i18next'), dynamicPrefixAsUsed: false });
    assert.ok(byRule(strict.issues)['unused-key']!.includes('en common:status.active'));
  });

  it('src and exclude limit the scanned files', () => {
    const r = analyze({ cwd: fixture('react-i18next'), exclude: ['src/Login.tsx'] });
    assert.deepEqual(r.usage!.files, ['src/App.tsx']);
    assert.ok(byRule(r.issues)['unused-key']!.includes('en auth:login.button'));
    assert.deepEqual(analyze({ cwd: fixture('react-i18next'), src: ['src/Login.tsx'] }).usage!.files, [
      'src/Login.tsx',
    ]);
  });

  it('custom checks', () => {
    const check: Check = {
      id: 'no-exclamation',
      description: 'No exclamation marks in Bangla.',
      defaultSeverity: 'warning',
      run: (ctx) =>
        [...(ctx.catalog.entries.get('bn')?.values() ?? [])]
          .filter((e) => e.text.includes('!'))
          .map((e) => ({
            rule: 'no-exclamation',
            severity: 'warning',
            key: e.key,
            locale: 'bn',
            message: 'has !',
          })),
    };
    registerCheck(check);
    assert.deepEqual(byRule(analyze({ cwd: fixture('react-i18next') }).issues)['no-exclamation'], [
      'bn common:title',
    ]);
    assert.throws(() => registerCheck({ ...check, id: 'Bad' }), TypeError);
  });

  it('duplicate keys and parse errors are reported with lines', () => {
    const cwd = project({
      'locales/en.json': '{\n  "a": "A",\n  "a": "B"\n}',
      'locales/bn.json': '{\n  "a": "এ",\n}x',
    });
    const r = analyze({ cwd, noSource: true });
    const dup = r.issues.find((i) => i.rule === 'duplicate-key')!;
    assert.equal(dup.line, 3);
    const pe = r.issues.find((i) => i.rule === 'parse-error')!;
    assert.equal(pe.file, 'locales/bn.json');
    assert.equal(pe.line, 3);
  });
});
