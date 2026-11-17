import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  builtinExtractors,
  detectExtractors,
  type Extractor,
  findCalls,
  getExtractor,
  LineIndex,
  maskJs,
  readStringArg,
  registerExtractor,
  scanUsage,
} from '../src/index.js';
import { fixture } from './helpers.js';

const opts = { namespaceSeparator: ':', keySeparator: '.' };

function run(id: string, source: string, file = 'file.tsx', functions?: string[]) {
  const e = getExtractor(id)!;
  const r = e.extract(source, file, { ...opts, functions: functions ?? e.defaultFunctions });
  return {
    keys: r.keys.map((k) => (k.namespace ? `${k.namespace}:${k.key}` : k.key)),
    dynamic: r.dynamic.map((d) => d.expression),
    raw: r,
  };
}

describe('source helpers', () => {
  it('maskJs blanks comments and string contents but keeps offsets', () => {
    const src = "const a = 'x(y)'; // t('no')\n/* t('no') */ t(`k`); const r = /'/; t('yes');";
    const m = maskJs(src);
    assert.equal(m.code.length, src.length);
    assert.ok(!m.code.includes("t('no')"));
    assert.ok(!m.noComments.includes("t('no')"));
    assert.ok(m.noComments.includes("'x(y)'"));
    assert.equal(findCalls(m.code, ['t']).length, 2);
  });

  it('keeps code inside template literal expressions visible', () => {
    const m = maskJs('const s = `a ${t("inner")} b`;');
    assert.equal(findCalls(m.code, ['t']).length, 1);
  });

  it('an apostrophe in JSX text does not hide the rest of the line', () => {
    const m = maskJs("<p>Don't miss {t('offer')} and it's {t('free')}</p>");
    assert.equal(findCalls(m.code, ['t']).length, 2);
    // ...but `return 'x'` still is a string.
    assert.equal(findCalls(maskJs("return 't(1)'").code, ['t']).length, 0);
  });

  it('readStringArg tells static from dynamic keys', () => {
    assert.deepEqual(readStringArg(" 'a.b', {}", 0), { kind: 'static', value: 'a.b', start: 1, end: 6 });
    assert.equal(readStringArg('`plain`)', 0)?.kind, 'static');
    const dyn = readStringArg('`errors.${code}`)', 0);
    assert.equal(dyn?.kind, 'dynamic');
    assert.equal(dyn?.kind === 'dynamic' && dyn.prefix, 'errors.');
    const concat = readStringArg("'menu.' + item)", 0);
    assert.equal(concat?.kind === 'dynamic' && concat.prefix, 'menu.');
    assert.equal(readStringArg('key)', 0)?.kind, 'dynamic');
    assert.equal(readStringArg(')', 0), undefined);
  });

  it('findCalls respects identifier boundaries and skips declarations', () => {
    const code = "format('x'); t ('a'); i18n.t('b'); function t(k) {}; obj.$t('c'); t<string>('d')";
    assert.deepEqual(
      findCalls(code, ['t', '$t']).map((c) => c.name),
      ['t', 't', '$t', 't'],
    );
  });

  it('LineIndex maps offsets', () => {
    const li = new LineIndex('ab\ncd\n\nef');
    assert.deepEqual(li.position(0), { line: 1, column: 1 });
    assert.deepEqual(li.position(4), { line: 2, column: 2 });
    assert.deepEqual(li.position(7), { line: 4, column: 1 });
  });
});

describe('i18next extractor', () => {
  it('reads t(), namespaces, options and Trans', () => {
    const r = run(
      'i18next',
      [
        "const { t } = useTranslation('common');",
        "t('a'); t('auth:login'); t('b', { ns: 'other' }); i18n.t('c');",
        "t('items', { count: n });",
        '<Trans i18nKey="welcome" />',
        '<Trans i18nKey={\'braced\'} ns="emails" />',
        '<Trans t={t} i18nKey="with.t" values={{ a: x > 1 }} />',
        't(`dyn.${x}`); t(name);',
      ].join('\n'),
    );
    assert.deepEqual(r.keys, [
      'common:a',
      'auth:login',
      'other:b',
      'common:c',
      'common:items',
      'common:welcome',
      'emails:braced',
      'common:with.t',
    ]);
    assert.deepEqual(r.dynamic, ['`dyn.${x}`', 'name']);
    assert.equal(r.raw.keys.find((k) => k.key === 'items')!.plural, true);
    assert.equal(r.raw.keys[0]!.line, 2);
  });

  it('applies keyPrefix and handles array namespaces and getFixedT', () => {
    assert.deepEqual(
      run('i18next', "useTranslation(['auth', 'common'], { keyPrefix: 'login' }); t('button');").keys,
      ['auth:login.button'],
    );
    assert.deepEqual(
      run('i18next', "const t = i18next.getFixedT(null, 'admin', 'users'); t('title');").keys,
      ['admin:users.title'],
    );
  });

  it('uses custom function names', () => {
    assert.deepEqual(run('i18next', "translate('x'); t('y');", 'a.ts', ['translate']).keys, ['x']);
  });
});

describe('vue-i18n extractor', () => {
  it('reads templates, directives, components and script setup', () => {
    const r = run(
      'vue-i18n',
      [
        '<template>',
        "  <!-- {{ $t('hidden') }} -->",
        "  <h1 :title=\"$t('attr.title')\">{{ $t('mustache') }} {{ $tc('plural', 2) }}</h1>",
        '  <p v-t="\'directive\'"></p>',
        '  <p v-t="{ path: \'directive.object\' }"></p>',
        '  <i18n-t keypath="component.key" tag="p"></i18n-t>',
        '  <i18n-t :keypath="`dyn.${x}`"></i18n-t>',
        '</template>',
        '<script setup>',
        "const { t, te } = useI18n(); t('script'); te('exists');",
        '</script>',
      ].join('\n'),
      'App.vue',
    );
    assert.deepEqual(r.keys.sort(), [
      'attr.title',
      'component.key',
      'directive',
      'directive.object',
      'exists',
      'mustache',
      'plural',
      'script',
    ]);
    assert.deepEqual(r.dynamic, ['`dyn.${x}`']);
  });

  it('reads plain scripts', () => {
    assert.deepEqual(run('vue-i18n', "i18n.global.t('from.js')", 'router.ts').keys, ['from.js']);
  });
});

describe('next-intl extractor', () => {
  it('scopes keys by translator variable', () => {
    const r = run(
      'next-intl',
      [
        "const t = useTranslations('Home');",
        "const nav = useTranslations('Layout.Nav');",
        'const all = useTranslations();',
        "const s = await getTranslations({ locale, namespace: 'Server' });",
        "t('title'); t.rich('terms', {}); t.has('maybe'); nav('home'); all('Root.key'); s('x');",
        "other('not.a.key');",
      ].join('\n'),
    );
    assert.deepEqual(r.keys, [
      'Home.title',
      'Home.terms',
      'Home.maybe',
      'Layout.Nav.home',
      'Root.key',
      'Server.x',
    ]);
  });
});

describe('react-intl extractor', () => {
  it('reads defineMessages, formatMessage and FormattedMessage', () => {
    const r = run(
      'react-intl',
      [
        'const m = defineMessages({',
        "  a: { id: 'msg.a', defaultMessage: 'A' },",
        '  b: { defaultMessage: "B", id: "msg.b" },',
        '});',
        "const one = defineMessage({ id: 'msg.one' });",
        "intl.formatMessage({ id: 'msg.inline' }); intl.formatMessage(m.a);",
        '<FormattedMessage id="msg.jsx" values={{ x: <b>1</b> }} />',
        '<FormattedMessage id={`msg.${k}`} />',
        "intl.formatMessage({ id: 'msg.' + k });",
      ].join('\n'),
      'App.jsx',
    );
    assert.deepEqual(r.keys, ['msg.a', 'msg.b', 'msg.one', 'msg.inline', 'msg.jsx']);
    assert.deepEqual(r.dynamic, ["'msg.' + k", '`msg.${k}`']);
  });
});

describe('ngx-translate extractor', () => {
  it('reads pipes, directives and the service', () => {
    const html = run(
      'ngx-translate',
      [
        "<h1>{{ 'A.TITLE' | translate }}</h1>",
        '<p>{{ "A.PARAMS" | translate: { n: 1 } }}</p>',
        '<p translate>A.CONTENT</p>',
        '<p [translate]="\'A.BOUND\'" [translateParams]="{ x: 1 }"></p>',
        '<p translate="A.ATTR"></p>',
        '<p>{{ key | translate }}</p>',
        "<!-- {{ 'HIDDEN' | translate }} -->",
      ].join('\n'),
      'a.component.html',
    );
    assert.deepEqual(html.keys.sort(), ['A.ATTR', 'A.BOUND', 'A.CONTENT', 'A.PARAMS', 'A.TITLE']);
    assert.deepEqual(html.dynamic, ['key']);
    const ts = run(
      'ngx-translate',
      "this.translate.instant('T.INSTANT'); this.translate.get('T.GET'); marker('T.MARKER');\n@Component({ template: `<b>{{ 'T.INLINE' | translate }}</b>` })",
      'a.component.ts',
    );
    assert.deepEqual(ts.keys.sort(), ['T.GET', 'T.INLINE', 'T.INSTANT', 'T.MARKER']);
  });
});

describe('generic extractor', () => {
  it('uses the configured functions in scripts and templates', () => {
    assert.deepEqual(run('generic', "__('a'); _t('b'); x.__('c')", 'a.js', ['__', '_t']).keys, [
      'a',
      'b',
      'c',
    ]);
    assert.deepEqual(
      run('generic', "<p>{{ t('in.svelte') }}</p><script>t('script')</script>", 'A.svelte').keys.sort(),
      ['in.svelte', 'script'],
    );
  });
});

describe('registry and detection', () => {
  it('detects extractors from package.json', () => {
    assert.deepEqual(
      detectExtractors(fixture('react-i18next')).map((e) => e.id),
      ['i18next'],
    );
    assert.deepEqual(
      detectExtractors(fixture('angular')).map((e) => e.id),
      ['ngx-translate'],
    );
    assert.deepEqual(
      detectExtractors(fixture('generic')).map((e) => e.id),
      ['generic'],
    );
  });

  it('every built-in extractor has a unique id and extensions', () => {
    const ids = builtinExtractors.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const e of builtinExtractors) assert.ok(e.extensions.length > 0);
  });

  it('accepts custom extractors', () => {
    const custom: Extractor = {
      id: 'lingui-macro',
      name: 'Lingui',
      extensions: ['tsx'],
      packages: ['@lingui/macro'],
      messageFormat: 'icu',
      extract: (text, file) => ({
        keys: [...text.matchAll(/<Trans id="([^"]+)"/g)].map((m) => ({
          key: m[1]!,
          file,
          line: 1,
          column: m.index + 1,
          extractor: 'lingui-macro',
        })),
        dynamic: [],
      }),
    };
    registerExtractor(custom);
    assert.equal(getExtractor('lingui-macro'), custom);
    assert.throws(() => registerExtractor({ ...custom, id: 'Bad Id' }), TypeError);
  });

  it('scanUsage reads a fixture project', () => {
    const usage = scanUsage(fixture('react-i18next'), [getExtractor('i18next')!], opts);
    assert.deepEqual(usage.files, ['src/App.tsx', 'src/Login.tsx']);
    assert.ok(usage.keys.some((k) => k.key === 'nav.home' && k.line === 11));
    assert.ok(!usage.keys.some((k) => k.key === 'commented.out'));
    assert.equal(usage.dynamic.length, 1);
  });
});
