import { createContext, scanCalls } from './common.js';
import { maskJs, readOption, readStringArg } from './source.js';
import type { Extractor } from './types.js';

const SUFFIXES = ['', '.rich', '.markup', '.raw', '.has'];

/**
 * next-intl: `const t = useTranslations('Namespace')` or
 * `await getTranslations('Namespace')` / `getTranslations({ namespace })`,
 * then `t('key')`, `t.rich('key')`, `t.markup`, `t.raw` and `t.has`. Each
 * translator variable keeps its own namespace, so several in one file work.
 */
export const nextIntlExtractor: Extractor = {
  id: 'next-intl',
  name: 'next-intl',
  extensions: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'mts'],
  packages: ['next-intl', 'use-intl'],
  messageFormat: 'icu',
  extract(text, file, options) {
    const ctx = createContext('next-intl', file, text);
    const { code, noComments } = maskJs(text);
    const sep = options.keySeparator;
    const bindings = new Map<string, string>();

    const re =
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations|createTranslator)\s*\(/g;
    for (const m of code.matchAll(re)) {
      const open = m.index + m[0].length;
      const arg = readStringArg(noComments, open);
      let ns = '';
      if (arg?.kind === 'static') ns = arg.value;
      else if (noComments.slice(open).trimStart().startsWith('{')) {
        ns = readOption(noComments.slice(open, open + 300), 'namespace') ?? '';
      }
      bindings.set(m[1]!, ns);
    }
    // Destructured translator from a custom hook is out of reach; documented.

    for (const [name, ns] of bindings) {
      const names = SUFFIXES.map((s) => `${name}${s}`);
      scanCalls(ctx, noComments, code, names, (key) => ({
        key: ns === '' ? key : key === '' ? ns : `${ns}${sep}${key}`,
      }));
    }
    return ctx.result;
  },
};
