'use strict';
const { executeConversationFork } = require('../../dist/operation');
const [source, target] = process.argv.slice(2);
executeConversationFork({ source, target, throughIndex: 1, dryRun: false }, {
  hooks: { afterBaseline: () => new Promise(resolve => setTimeout(resolve, 100)) }
}).then(() => process.stdout.write('completed\n')).catch(error => {
  process.stdout.write(`${error.code}\n`); process.exitCode = 1;
});
