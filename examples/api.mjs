// Runs against the local build: npm run build && node examples/api.mjs
import { fileURLToPath } from 'node:url';
import { analyze, formatMarkdown, parseIcu, pluralCategories } from '../dist/esm/index.js';

const result = analyze({ cwd: fileURLToPath(new URL('./bangla-react', import.meta.url)) });

for (const s of result.stats) console.log(`${s.locale}: ${s.coverage}% translated, ${s.missing} missing`);
for (const issue of result.issues) console.log(`${issue.severity} ${issue.rule}: ${issue.message}`);

// The same report as Markdown, e.g. for a pull request comment.
console.log(formatMarkdown(result).split('\n').slice(0, 6).join('\n'));

// Building blocks are exported too.
console.log(pluralCategories('bn'), pluralCategories('ar'));
console.log(parseIcu('{count, plural, one {# বই} other {# বই}}').arguments);
