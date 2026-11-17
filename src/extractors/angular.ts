import { addDynamic, addKey, createContext, scanCalls } from './common.js';
import { maskHtmlComments, maskJs } from './source.js';
import type { Extractor } from './types.js';

const SERVICE_CALLS = [
  'translate.instant',
  'translate.get',
  'translate.stream',
  'translateService.instant',
  'translateService.get',
  'translateService.stream',
  'marker',
  '_',
];

/**
 * Angular ngx-translate: `{{ 'KEY' | translate }}` (also with parameters),
 * `[translate]="'KEY'"`, `<span translate>KEY</span>`, `translate="KEY"`,
 * and `translate.instant/get/stream('KEY')` or `marker('KEY')` in TypeScript.
 */
export const angularExtractor: Extractor = {
  id: 'ngx-translate',
  name: 'Angular ngx-translate',
  extensions: ['html', 'ts'],
  packages: ['@ngx-translate/core'],
  messageFormat: 'i18next',
  defaultFunctions: SERVICE_CALLS,
  extract(text, file, options) {
    const ctx = createContext('ngx-translate', file, text);
    if (file.endsWith('.ts')) {
      const { code, noComments } = maskJs(text);
      scanCalls(ctx, noComments, code, options.functions ?? SERVICE_CALLS);
      // Inline templates: template: `...`
      for (const m of noComments.matchAll(/\btemplate\s*:\s*`([\s\S]*?)`/g)) {
        scanTemplate(ctx, ' '.repeat(m.index + m[0].indexOf('`') + 1) + m[1]!);
      }
      return ctx.result;
    }
    scanTemplate(ctx, maskHtmlComments(text));
    return ctx.result;
  },
};

function scanTemplate(ctx: ReturnType<typeof createContext>, html: string): void {
  // 'KEY' | translate  and  'KEY' | translate: params
  for (const m of html.matchAll(/(['"])((?:(?!\1).)+?)\1\s*\|\s*translate\b/g))
    addKey(ctx, m[2]!, m.index + 1);
  // variable | translate -> dynamic
  for (const m of html.matchAll(/\{\{\s*([A-Za-z_$][\w$.?[\]]*)\s*\|\s*translate\b/g))
    addDynamic(ctx, m[1]!, '', m.index + m[0].indexOf(m[1]!));
  // [translate]="'KEY'"
  for (const m of html.matchAll(/\[translate\]\s*=\s*"([^"]*)"/g)) {
    const inner = m[1]!;
    const lit = /^\s*'([^']*)'\s*$/.exec(inner);
    const offset = m.index + m[0].indexOf(inner);
    if (lit) addKey(ctx, lit[1]!, offset + inner.indexOf("'") + 1);
    else addDynamic(ctx, inner.trim(), '', offset);
  }
  // translate="KEY" (static attribute form)
  for (const m of html.matchAll(/(?<![\w[(.-])translate\s*=\s*"([^"{}]+)"/g))
    addKey(ctx, m[1]!.trim(), m.index + m[0].indexOf('"') + 1);
  // <span translate>KEY</span> and <span translate [translateParams]="...">KEY</span>
  for (const m of html.matchAll(
    /<([a-zA-Z][\w-]*)\b[^>]*?(?<![\w[(.-])translate(?=[\s>])[^>]*>([^<]+)<\/\1>/g,
  )) {
    const key = m[2]!.trim();
    if (key && !key.includes('{{')) addKey(ctx, key, m.index + m[0].lastIndexOf(m[2]!) + m[2]!.indexOf(key));
  }
}
