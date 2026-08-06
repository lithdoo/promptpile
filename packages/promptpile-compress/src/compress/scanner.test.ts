import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMessageFileName } from './scanner';

describe('Conversation Protocol scanner', () => {
  it('preserves role casing and requires exact protocol filenames', () => {
    const custom = parseMessageFileName('/conversation', '[1]CustomRole.md');
    assert.equal(custom?.role, 'CustomRole');
    assert.equal(custom?.extension, 'md');
    assert.equal(custom?.fileKind, 'message');

    assert.equal(
      parseMessageFileName('/conversation', '[2]user.MD'),
      null
    );
    assert.equal(
      parseMessageFileName('/conversation', '[3]Assistant.CALLS.JSONL'),
      null
    );
    assert.equal(
      parseMessageFileName('/conversation', '[4]assistant.calls.jsonl')
        ?.fileKind,
      'calls'
    );
  });
});
