export {
  type AnalyzeOptions,
  type AnalyzeResult,
  analyze,
  computeStats,
  type LocaleStats,
  resolveExtractors,
  resolveMessageFormat,
} from './analyze.js';
export { builtinChecks } from './checks/builtin.js';
export {
  allChecks,
  buildContext,
  type ContextOptions,
  keyMatcher,
  qualify,
  registerCheck,
  type RunChecksOptions,
  runChecks,
} from './checks/index.js';
export type { Check, CheckContext, Issue, Severity } from './checks/types.js';
export {
  CONFIG_FILE,
  ConfigError,
  type FillMode,
  type I18nCheckConfig,
  loadConfig,
  type MessageFormat,
  type RuleSetting,
  validateConfig,
} from './config.js';
export {
  builtinExtractors,
  DEFAULT_SOURCE_EXCLUDE,
  DEFAULT_SOURCE_GLOBS,
  detectExtractors,
  extractorIds,
  getExtractor,
  registerExtractor,
  scanUsage,
  type UsageScan,
} from './extractors/index.js';
export {
  callArguments,
  findCalls,
  LineIndex,
  maskJs,
  readOption,
  readStringArg,
} from './extractors/source.js';
export type { DynamicKey, ExtractOptions, ExtractResult, Extractor, UsedKey } from './extractors/types.js';
export {
  collectTasks,
  EXPORT_FORMATS,
  type ExportFormat,
  formatTasks,
  TASK_REASONS,
  TASK_RULES,
  type TaskReason,
  type TranslationTask,
  tasksToCsv,
  tasksToXliff,
} from './export.js';
export { applyFixes, type FileChange, type FixOptions, planFixes } from './fix.js';
export {
  type Catalog,
  CatalogError,
  type Entry,
  type LocaleFile,
  loadCatalog,
  type LoadCatalogOptions,
  parseLocaleFile,
} from './locales/catalog.js';
export {
  DEFAULT_LOCALE_PATTERNS,
  discoverLocaleFiles,
  type LocaleFileRef,
  patternToRegExp,
} from './locales/discover.js';
export { parseJsonTree, stringifyJsonTree } from './locales/json.js';
export { parsePo, parsePoTree, type PoEntry, type PoFile } from './locales/po.js';
export { leaves, type ObjectNode, type TreeNode } from './locales/tree.js';
export { parseYamlTree, stringifyYamlTree } from './locales/yaml.js';
export { type IcuArgument, type IcuResult, parseIcu } from './message/icu.js';
export {
  comparePlaceholders,
  extractPlaceholders,
  pluralCategories,
  splitPluralKey,
} from './message/placeholders.js';
export {
  type Format,
  formatGithub,
  formatJson,
  formatMarkdown,
  formatPretty,
  formatResult,
} from './report/index.js';
export { VERSION } from './version.js';
