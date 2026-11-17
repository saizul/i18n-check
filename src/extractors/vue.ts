import { addDynamic, addKey, createContext, scanAttribute, scanCalls, splitComponent } from './common.js';
import { maskJs, readStringArg } from './source.js';
import type { Extractor } from './types.js';

const FUNCTIONS = ['$t', 't', '$tc', 'tc', '$te', 'te', '$tm', 'tm', '$rt', 'i18n.global.t', 'i18n.t'];

/**
 * vue-i18n: `$t('key')`, `t('key')` from `useI18n()`, `$tc`, `$te`, `$tm`,
 * `i18n.global.t(...)`, the `v-t` directive and the `<i18n-t keypath>` /
 * `<i18n path>` components, in `.vue` single-file components and scripts.
 */
export const vueI18nExtractor: Extractor = {
  id: 'vue-i18n',
  name: 'vue-i18n',
  extensions: ['vue', 'js', 'ts', 'mjs', 'mts'],
  packages: ['vue-i18n', '@intlify/core', 'petite-vue-i18n', '@nuxtjs/i18n'],
  messageFormat: 'vue',
  defaultFunctions: FUNCTIONS,
  extract(text, file, options) {
    const ctx = createContext('vue-i18n', file, text);
    const names = options.functions ?? FUNCTIONS;
    const isSfc = file.endsWith('.vue');
    const { script, markup } = isSfc ? splitComponent(text) : { script: text, markup: '' };

    const masks = maskJs(script);
    scanCalls(ctx, masks.noComments, masks.code, names);

    if (markup) {
      // Template expressions live inside attribute values and {{ }}; mask
      // nothing but HTML comments and read calls directly.
      scanCalls(ctx, markup, markup, names);
      // v-t="'key'" or v-t="{ path: 'key' }"
      for (const m of markup.matchAll(/\bv-t\s*=\s*(["'])([\s\S]*?)\1/g)) {
        const inner = m[2]!;
        const offset = m.index + m[0].indexOf(inner);
        const lit = /^\s*(['"`])(.*?)\1\s*$/.exec(inner);
        const path = /path\s*:\s*(['"`])(.*?)\1/.exec(inner);
        if (lit) addKey(ctx, lit[2]!, offset);
        else if (path) addKey(ctx, path[2]!, offset + inner.indexOf(path[0]));
        else addDynamic(ctx, inner.trim(), '', offset);
      }
      // <i18n-t keypath="key">, <i18n path="key"> and their bound forms.
      for (const attr of ['keypath', 'path']) {
        scanAttribute(ctx, markup, /i18n-t|I18nT|i18n|i18n-d|i18n-n/, attr);
        for (const m of markup.matchAll(
          new RegExp(`<(?:i18n-t|I18nT|i18n)\\b[^>]*?:${attr}\\s*=\\s*"([^"]*)"`, 'g'),
        )) {
          const inner = m[1]!;
          const offset = m.index + m[0].lastIndexOf(inner);
          const arg = readStringArg(inner, 0);
          if (arg?.kind === 'static' && inner.trim().length === arg.end - arg.start)
            addKey(ctx, arg.value, offset);
          else addDynamic(ctx, inner.trim(), arg?.kind === 'dynamic' ? arg.prefix : '', offset);
        }
      }
    }
    return ctx.result;
  },
};
