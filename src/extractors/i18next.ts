import { addKey, type CallMatch, createContext, scanAttribute, scanCalls } from './common.js';
import { maskJs, readOption, readStringArg } from './source.js';
import type { Extractor } from './types.js';

const DEFAULT_FUNCTIONS = ['t', 'i18n.t', 'i18next.t'];

/**
 * i18next and react-i18next: `t('key')`, `t('ns:key')`, `t('key', { ns })`,
 * `useTranslation('ns')` / `useTranslation(['a', 'b'], { keyPrefix })`,
 * `withTranslation('ns')`, `getFixedT(lng, 'ns', 'prefix')` and
 * `<Trans i18nKey="key" ns="ns">`.
 */
export const i18nextExtractor: Extractor = {
  id: 'i18next',
  name: 'i18next / react-i18next',
  extensions: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'],
  packages: ['i18next', 'react-i18next', 'next-i18next', 'i18next-vue', 'svelte-i18next'],
  messageFormat: 'i18next',
  defaultFunctions: DEFAULT_FUNCTIONS,
  pluralSuffixes: true,
  extract(text, file, options) {
    const ctx = createContext('i18next', file, text);
    const { code, noComments } = maskJs(text);
    const nsSep = options.namespaceSeparator;

    // The namespace and key prefix of the file come from the first hook or HOC.
    let fileNs: string | undefined;
    let keyPrefix: string | undefined;
    const hook = /(?<![\w$])(?:useTranslation|withTranslation|getFixedT)\s*\(/g;
    for (const m of code.matchAll(hook)) {
      const open = m.index + m[0].length;
      const isFixed = m[0].startsWith('getFixedT');
      let pos = open;
      if (isFixed) {
        // getFixedT(lng, ns, keyPrefix): skip the language argument.
        const comma = noComments.indexOf(',', open);
        if (comma === -1) continue;
        pos = comma + 1;
      }
      const arg = readStringArg(noComments, pos);
      if (arg?.kind === 'static') fileNs ??= arg.value;
      else if (noComments[skipWs(noComments, pos)] === '[') {
        const first = readStringArg(noComments, skipWs(noComments, pos) + 1);
        if (first?.kind === 'static') fileNs ??= first.value;
      }
      const args = noComments.slice(open, noComments.indexOf(')', open) + 200);
      keyPrefix ??= readOption(args, 'keyPrefix');
      if (isFixed && keyPrefix === undefined && arg) {
        const third = noComments.indexOf(',', arg.end);
        if (third !== -1 && third < noComments.indexOf(')', arg.end)) {
          const p = readStringArg(noComments, third + 1);
          if (p?.kind === 'static') keyPrefix = p.value;
        }
      }
    }

    const qualify = (raw: string, match?: CallMatch) => {
      let key = raw;
      let namespace: string | undefined;
      const idx = nsSep ? key.indexOf(nsSep) : -1;
      if (idx > 0) {
        namespace = key.slice(0, idx);
        key = key.slice(idx + nsSep.length);
      } else if (match) {
        namespace = readOption(match.args, 'ns') ?? fileNs;
      } else namespace = fileNs;
      if (idx <= 0 && keyPrefix && !(match && /(?<![\w$])keyPrefix\s*:/.test(match.args))) {
        key = key === '' ? keyPrefix : `${keyPrefix}${options.keySeparator}${key}`;
      }
      const plural = match ? /(?<![\w$])count\s*[:,}]/.test(match.args) : false;
      const out: { key: string; namespace?: string; plural?: boolean } = { key, plural };
      if (namespace !== undefined) out.namespace = namespace;
      return out;
    };

    scanCalls(ctx, noComments, code, options.functions ?? DEFAULT_FUNCTIONS, qualify);

    // <Trans i18nKey="key" ns="ns" />; a `t` prop or `ns` attribute sets the namespace.
    scanAttribute(ctx, noComments, /Trans/, 'i18nKey', (value, offset, tag) => {
      const ns = /(?<![\w-])ns\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"]([^'"]*)['"]\s*\})/.exec(tag);
      const q = qualify(value);
      if (ns) q.namespace = ns[1] ?? ns[2] ?? ns[3];
      if (/(?<![\w-])count\s*=/.test(tag)) q.plural = true;
      addKey(ctx, q.key, offset, q);
    });

    return ctx.result;
  },
};

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}
