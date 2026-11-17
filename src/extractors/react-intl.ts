import { addDynamic, addKey, createContext, scanAttribute } from './common.js';
import { callArguments, findCalls, maskJs, readStringArg } from './source.js';
import type { Extractor } from './types.js';

const CALLS = ['defineMessages', 'defineMessage', 'formatMessage', 'intl.formatMessage', '$t', 'intl.$t'];
const COMPONENTS = /FormattedMessage|FormattedHTMLMessage/;

/**
 * react-intl / FormatJS: `id` fields in `defineMessages({...})`,
 * `defineMessage({...})` and `formatMessage({ id })`, and
 * `<FormattedMessage id="key" />`.
 */
export const reactIntlExtractor: Extractor = {
  id: 'react-intl',
  name: 'react-intl / FormatJS',
  extensions: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'mts'],
  packages: ['react-intl', '@formatjs/intl', 'vue-intl'],
  messageFormat: 'icu',
  extract(text, file) {
    const ctx = createContext('react-intl', file, text);
    const { code, noComments } = maskJs(text);

    for (const call of findCalls(code, CALLS)) {
      const args = callArguments(noComments, call.open);
      // Every `id:` inside the call arguments, at any depth (defineMessages nests them).
      const idRe = /(?<![\w$.])id\s*:\s*/g;
      let found = false;
      for (const m of args.matchAll(idRe)) {
        const at = call.open + m.index + m[0].length;
        const arg = readStringArg(noComments, at);
        if (!arg) continue;
        found = true;
        if (arg.kind === 'static') addKey(ctx, arg.value, arg.start);
        else addDynamic(ctx, arg.expression, arg.prefix, arg.start);
      }
      // formatMessage(messages.greeting) refers to an id defined elsewhere: nothing to record.
      if (!found && /^\s*['"`]/.test(args) && call.name.endsWith('$t')) {
        const arg = readStringArg(noComments, call.open);
        if (arg?.kind === 'static') addKey(ctx, arg.value, arg.start);
      }
    }
    scanAttribute(ctx, noComments, COMPONENTS, 'id');
    return ctx.result;
  },
};
