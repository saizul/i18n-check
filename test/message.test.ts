import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  comparePlaceholders,
  extractPlaceholders,
  parseIcu,
  pluralCategories,
  splitPluralKey,
} from '../src/index.js';

describe('parseIcu', () => {
  it('reads arguments, types, cases and tags', () => {
    const r = parseIcu(
      'Hi {name}, {count, plural, offset:1 =0 {none} one {# item for <b>{who}</b>} other {# items}} on {d, date, short}',
    );
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.arguments.map((a) => [a.name, a.type, a.cases]),
      [
        ['name', 'simple', undefined],
        ['who', 'simple', undefined],
        ['count', 'plural', ['=0', 'one', 'other']],
        ['d', 'date', undefined],
      ],
    );
    assert.deepEqual(r.tags, ['b']);
  });

  it('handles select, nesting and apostrophe quoting', () => {
    const r = parseIcu(
      "{g, select, male {He} female {She} other {They}} said '{hello}' and it''s {n, number, ::currency/EUR}",
    );
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.arguments.map((a) => a.name),
      ['g', 'n'],
    );
  });

  it('reports syntax errors', () => {
    assert.match(parseIcu('Hello {name').error!, /Unterminated|Missing|Expected/);
    assert.match(parseIcu('{n, plural, one {x}}').error!, /no "other" case/);
    assert.match(parseIcu('oops }').error!, /Unexpected "\}"/);
    assert.match(parseIcu('{}').error!, /Empty argument name/);
    assert.match(parseIcu('{n, plural, one x}').error!, /Expected "\{"/);
  });
});

describe('extractPlaceholders', () => {
  it('i18next', () => {
    assert.deepEqual(
      extractPlaceholders('{{name}} {{ count }} {{- html}} {{val, number}} $t(other.key)', 'i18next'),
      ['$t(other.key)', '{{count}}', '{{html}}', '{{name}}', '{{val}}'],
    );
  });

  it('vue-i18n', () => {
    assert.deepEqual(extractPlaceholders('{name} {0} @:common.brand @.lower:x.y', 'vue'), [
      '@:common.brand',
      '@:x.y',
      '{0}',
      '{name}',
    ]);
  });

  it('ICU', () => {
    assert.deepEqual(extractPlaceholders('<link>{n, plural, one {# x} other {# y}}</link> {who}', 'icu'), [
      '<link>',
      '{n}',
      '{who}',
    ]);
  });

  it('printf counts repeats and ignores %%', () => {
    assert.deepEqual(extractPlaceholders('%s and %s, %d%% %1$s %(name)s', 'printf'), [
      '%(name)s',
      '%1$s',
      '%d',
      '%s',
      '%s',
    ]);
    assert.deepEqual(extractPlaceholders('100% sure', 'printf'), []);
  });

  it('auto mixes the common styles', () => {
    assert.deepEqual(extractPlaceholders('{{a}} {b} %s', 'auto'), ['%s', '{b}', '{{a}}']);
  });
});

describe('comparePlaceholders', () => {
  it('finds missing and extra placeholders', () => {
    assert.deepEqual(comparePlaceholders('Hi {{name}}', 'হাই {{user}}', 'i18next'), {
      missing: ['{{name}}'],
      extra: ['{{user}}'],
    });
    assert.deepEqual(comparePlaceholders('%s of %s', '%s', 'printf'), { missing: ['%s'], extra: [] });
    assert.deepEqual(comparePlaceholders('{a} {b}', '{b} {a}', 'icu'), { missing: [], extra: [] });
  });
});

describe('plural categories', () => {
  it('come from Intl.PluralRules', () => {
    assert.deepEqual(pluralCategories('en'), ['one', 'other']);
    assert.deepEqual(pluralCategories('bn'), ['one', 'other']);
    assert.deepEqual(pluralCategories('ja'), ['other']);
    assert.deepEqual(pluralCategories('ar').sort(), ['few', 'many', 'one', 'other', 'two', 'zero']);
    assert.deepEqual(pluralCategories('pt_BR'), pluralCategories('pt-BR'));
    assert.ok(pluralCategories('en', 'ordinal').includes('few'));
  });

  it('splitPluralKey', () => {
    assert.deepEqual(splitPluralKey('items_other'), { stem: 'items', category: 'other', ordinal: false });
    assert.deepEqual(splitPluralKey('place_ordinal_few'), { stem: 'place', category: 'few', ordinal: true });
    assert.equal(splitPluralKey('items'), undefined);
    assert.equal(splitPluralKey('_one'), undefined);
  });
});
