// The package also works with require(). Run after `npm run build`:
//   node examples/commonjs.cjs
const path = require('node:path');
const { analyze, extractPlaceholders } = require('../dist/cjs/index.js');

const result = analyze({ cwd: path.join(__dirname, 'next-intl-bn') });
console.log(result.catalog.locales, result.issues.length);
console.log(extractPlaceholders('হ্যালো {{name}}, %s', 'auto'));
