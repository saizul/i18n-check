const { __ } = require('./i18n');

console.log(__('greeting', 'Saizul'));
console.log(__("count", 3, 'docs'));
console.log(__('named', { name: 'x' }));
