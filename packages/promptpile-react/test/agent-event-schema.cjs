'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'agent-event-v1.schema.json')));
const validate = new Ajv2020({ strict: true, strictRequired: false }).compile(schema);
const base = { schema_version: 1, session_id: 'react_test', sequence: 0 };
const valid = [
  { ...base, type: 'session.started', max_steps: 1 },
  { ...base, type: 'phase.started', phase: 'thought', step_index: 0 },
  { ...base, type: 'phase.completed', phase: 'check', step_index: 0, continue: false },
  { ...base, type: 'phase.started', phase: 'final', steps_completed: 1 },
  { ...base, type: 'final.delta', content: 'answer' },
  { ...base, type: 'session.completed', stop_reason: 'final', steps_completed: 1, final: { status: 'completed', content: 'answer' } },
  { ...base, type: 'session.completed', stop_reason: 'max_step', steps_completed: 1, final: { status: 'skipped' } },
  { ...base, type: 'session.failed', phase: 'check', steps_completed: 0, error: { code: 'check_decision_invalid', message: 'invalid' } },
  { ...base, type: 'session.failed', phase: 'check', steps_completed: 1, error: { code: 'max_step_exhausted', message: 'budget exhausted' } }
];
for (const event of valid) assert.strictEqual(validate(event), true, JSON.stringify(validate.errors));
assert.strictEqual(
  validate({ ...valid[0], future_optional_field: { ignored: true } }),
  true,
  'unknown optional fields remain forward-compatible'
);
for (const event of [
  { ...base, type: 'session.completed', stop_reason: 'error', steps_completed: 0, final: { status: 'skipped' } },
  { ...base, type: 'session.completed', stop_reason: 'final', steps_completed: 1, final: { status: 'completed' } },
  { ...base, type: 'session.failed', phase: 'check', steps_completed: 0, error: { code: 'unknown', message: 'x' } },
  { ...base, type: 'phase.started', phase: 'final', step_index: 1 }
  ,{ ...base, type: 'phase.completed', phase: 'check', step_index: 0 }
  ,{ ...base, type: 'usage.updated', usage: 1 }
  ,{ ...base, type: 'session.started', max_steps: 1, phase: 'thought' }
  ,{ ...base, type: 'final.delta', content: 'x', error: { code: 'internal_error', message: 'x' } }
  ,{ ...base, type: 'session.completed', stop_reason: 'final', steps_completed: 1, final: { status: 'skipped' }, error: { code: 'internal_error', message: 'x' } }
  ,{ ...base, type: 'session.failed', phase: 'final', steps_completed: 1, error: { code: 'internal_error', message: 'x' }, stop_reason: 'final', final: { status: 'skipped' } }
]) assert.strictEqual(validate(event), false, `unexpectedly valid: ${JSON.stringify(event)}`);
console.log('promptpile-react agent event schema tests ok');
