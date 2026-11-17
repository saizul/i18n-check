import { createContext, scanCalls, splitComponent } from './common.js';
import { maskHtmlComments, maskJs } from './source.js';
import type { Extractor } from './types.js';

const DEFAULT_FUNCTIONS = ['t', '$t', '__', 'i18n.t', 'translate'];

/**
 * Any library with a translate function: `t('key')`, `__('key')`,
 * `i18n.t('key')`, ... The names come from `functions` in the config
 * (`--functions t,_t,translate`). Works in scripts, single-file components
 * and plain templates.
 */
export const genericExtractor: Extractor = {
  id: 'generic',
  name: 'Plain t() calls',
  extensions: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'html', 'astro'],
  packages: [],
  messageFormat: 'auto',
  defaultFunctions: DEFAULT_FUNCTIONS,
  extract(text, file, options) {
    const ctx = createContext('generic', file, text);
    const names = options.functions ?? DEFAULT_FUNCTIONS;
    if (/\.(vue|svelte|astro)$/.test(file)) {
      const { script, markup } = splitComponent(text);
      const m = maskJs(script);
      scanCalls(ctx, m.noComments, m.code, names);
      scanCalls(ctx, markup, markup, names);
    } else if (file.endsWith('.html')) {
      const html = maskHtmlComments(text);
      scanCalls(ctx, html, html, names);
    } else {
      const m = maskJs(text);
      scanCalls(ctx, m.noComments, m.code, names);
    }
    return ctx.result;
  },
};
