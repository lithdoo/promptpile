import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARCHIVE_READ_DEFAULTS,
  ARCHIVE_SEARCH_DEFAULTS,
  ArchiveDomainError,
  archiveExitCode,
  archiveJsonFailure,
  archiveJsonSuccess,
  resolveReadToolResults,
  resolveSearchToolResults,
  type ArchiveErrorCode,
} from './contracts';

describe('archive machine contract', () => {
  it('freezes read and search defaults', () => {
    assert.deepEqual(ARCHIVE_READ_DEFAULTS, { includeToolResults: true });
    assert.deepEqual(ARCHIVE_SEARCH_DEFAULTS, {
      limit: 20,
      includeToolResults: false,
      caseSensitive: false,
    });
    assert.equal(resolveReadToolResults({}), true);
    assert.equal(resolveSearchToolResults({}), false);
    assert.equal(
      resolveSearchToolResults({ includeToolResults: true }),
      true
    );
    assert.equal(resolveReadToolResults({ noToolResults: true }), false);
  });

  it('rejects conflicting tool-result flags', () => {
    assert.throws(
      () =>
        resolveSearchToolResults({
          includeToolResults: true,
          noToolResults: true,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ArchiveDomainError);
        assert.equal(error.code, 'INVALID_QUERY');
        return true;
      }
    );
  });

  it('uses a stable JSON envelope', () => {
    assert.deepEqual(archiveJsonSuccess({ turnIdx: 4 }), {
      ok: true,
      data: { turnIdx: 4 },
    });
    assert.deepEqual(
      archiveJsonFailure(
        new ArchiveDomainError('TURN_NOT_FOUND', 'archived turn not found: 4')
      ),
      {
        ok: false,
        error: {
          code: 'TURN_NOT_FOUND',
          message: 'archived turn not found: 4',
        },
      }
    );
  });

  it('maps every domain error to a stable process exit code', () => {
    const expected: Record<ArchiveErrorCode, number> = {
      NO_ARCHIVE: 3,
      TURN_NOT_FOUND: 3,
      INVALID_ARCHIVE: 4,
      INVALID_QUERY: 2,
      SEARCH_TIMEOUT: 124,
      IO_ERROR: 1,
    };
    for (const [code, exitCode] of Object.entries(expected)) {
      assert.equal(archiveExitCode(code as ArchiveErrorCode), exitCode);
    }
  });
});
