'use strict';
const { executeConversationFork } = require('../../dist/operation');
const [source, target, point] = process.argv.slice(2);
const crash = () => process.exit(73);
executeConversationFork({ source, target, throughIndex: 0, dryRun: false }, {
  hooks: point === 'before_publish' ? { beforePublish: crash } : { afterPublish: crash }
}).then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
