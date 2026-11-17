import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyze,
  ConfigError,
  formatGithub,
  formatJson,
  formatMarkdown,
  formatPretty,
  keyMatcher,
  validateConfig,
} from '../src/index.js';
import { colors } from '../src/report/index.js';
import { fixture, project } from './helpers.js';

describe('reporters', () => {
  const result = analyze({ cwd: fixture('react-i18next') });

  it('pretty output can be colored and filtered', () => {
    const colored = formatPretty(result, colors(true));
    assert.ok(colored.includes('\u001b[31merror\u001b[39m'));
    const errorsOnly = formatPretty(result, colors(false), { minSeverity: 'error' });
    assert.ok(!errorsOnly.includes('unused-key'));
    assert.ok(errorsOnly.includes('missing-key'));
  });

  it('markdown escapes table syntax', () => {
    const cwd = project({
      'locales/en.json': '{"a|b": "x | y", "c": "z"}',
      'locales/bn.json': '{"c": "z"}',
    });
    const md = formatMarkdown(analyze({ cwd, noSource: true }));
    assert.ok(md.includes('`a\\|b`'));
    assert.ok(md.includes('x \\| y'));
  });

  it('GitHub annotations escape newlines, percent signs and property separators', () => {
    const cwd = project({
      'locales/en.json': '{"a": "100%,\\nnext: line", "b": "B"}',
      'locales/bn.json': '{"b": "B"}',
    });
    const out = formatGithub(analyze({ cwd, noSource: true }));
    const line = out.split('\n').find((l) => l.includes('missing-key'))!;
    assert.match(line, /^::error file=locales\/bn\.json,title=i18n-check missing-key::a is missing in bn/);
    assert.ok(line.includes('100%25,'));
    assert.ok(!/\n/.test(line));
  });

  it('JSON output has stats and every issue', () => {
    const data = JSON.parse(formatJson(result));
    assert.equal(data.issues.length, result.issues.length);
    assert.deepEqual(
      data.stats.map((s: { locale: string }) => s.locale),
      ['en', 'ar', 'bn'],
    );
    assert.equal(data.files[0].namespace, 'common');
  });

  it('a clean project reports no problems', () => {
    const cwd = project({
      'locales/en.json': '{"hello": "Hello {{name}}"}',
      'locales/bn.json': '{"hello": "হ্যালো {{name}}"}',
      'src/a.js': "t('hello', { name })",
    });
    const r = analyze({ cwd });
    assert.deepEqual(r.issues, []);
    assert.match(
      formatPretty(r, colors(false)),
      /✔ 0 errors, 0 warnings, 0 info · 2 locales, 1 key, 1 source file/,
    );
    assert.match(formatMarkdown(r), /No problems found\./);
  });
});

describe('config validation', () => {
  it('accepts a full config', () => {
    assert.doesNotThrow(() =>
      validateConfig({
        $schema: 'x',
        locales: ['a/{locale}.json'],
        baseLocale: 'en',
        rules: { 'unused-key': 'off' },
        fix: { fill: 'empty', sort: false },
        dynamicPrefixAsUsed: false,
      }),
    );
  });

  it('lists every problem', () => {
    assert.throws(
      () =>
        validateConfig({
          locales: 3,
          src: 'src',
          baseLocale: 1,
          messageFormat: 'xml',
          rules: { a: 'loud' },
          fix: { fill: 'nothing', extra: 1 },
          dynamicPrefixAsUsed: 'yes',
          typo: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        const m = (err as Error).message;
        for (const part of [
          'unknown option "typo"',
          '"src" must be an array',
          '"baseLocale" must be a string',
          '"locales" must be a string or an array',
          '"messageFormat" must be',
          'rule "a" must be',
          '"fix.fill" must be',
          'unknown option "fix.extra"',
          '"dynamicPrefixAsUsed" must be',
        ])
          assert.ok(m.includes(part), part);
        return true;
      },
    );
    assert.throws(() => validateConfig([]), ConfigError);
  });

  it('keyMatcher wildcards', () => {
    const m = keyMatcher(['errors.*', 'common:brand', '*.email']);
    assert.ok(m('errors.network.timeout'));
    assert.ok(m('common:brand'));
    assert.ok(m('footer.email'));
    assert.ok(!m('common:brands'));
    assert.ok(!keyMatcher([])('x'));
  });
});
