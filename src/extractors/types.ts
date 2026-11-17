import type { MessageFormat } from '../config.js';

/** A key found in source code. */
export interface UsedKey {
  key: string;
  /** Namespace when the code names one (i18next `ns:key`, `useTranslation('ns')`). */
  namespace?: string;
  file: string;
  line: number;
  column: number;
  /** ID of the extractor that found it. */
  extractor: string;
  /** Called with a count, so plural variants (`key_one`, `key_other`) are used. */
  plural?: boolean;
}

/** A translation call whose key is computed at runtime. */
export interface DynamicKey {
  /** The source text of the key expression, e.g. `` `errors.${code}` ``. */
  expression: string;
  /** The static beginning of the key, e.g. `errors.`; may be empty. */
  prefix: string;
  namespace?: string;
  file: string;
  line: number;
  column: number;
  extractor: string;
}

export interface ExtractResult {
  keys: UsedKey[];
  dynamic: DynamicKey[];
}

/** Settings shared by all extractors. */
export interface ExtractOptions {
  /** Function names for translate calls, for extractors that use them. */
  functions?: string[];
  namespaceSeparator: string;
  keySeparator: string;
}

/**
 * Finds translation keys in one kind of code. Extractors are plain objects,
 * so a new library needs one file in `src/extractors/` and a line in
 * `src/extractors/index.ts`.
 */
export interface Extractor {
  /** Stable kebab-case ID used in configs and `--extractor`. */
  id: string;
  /** Library name for messages and the README. */
  name: string;
  /** File extensions this extractor reads, without the dot. */
  extensions: string[];
  /** npm packages whose presence in package.json enables the extractor automatically. */
  packages: string[];
  /** Placeholder syntax of the library, used when `messageFormat` is `auto`. */
  messageFormat: MessageFormat;
  /** Default translate function names; `functions` in the config replaces them. */
  defaultFunctions?: string[];
  /** Plural keys use suffixes such as `_one` and `_other` (i18next). */
  pluralSuffixes?: boolean;
  extract(source: string, file: string, options: ExtractOptions): ExtractResult;
}
