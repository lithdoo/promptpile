# promptpile-compress

Conversation lifecycle compression, archive, restore, and recovery for
[Promptpile](https://github.com/lithdoo/promptpile).

> Beta software. Archive and Conversation Protocol behavior may evolve before
> the first stable release.

## Install

```bash
npm install promptpile-compress@beta
```

Node.js 18 or newer is required.

## CLI

```bash
promptpile-compress compress -d ./messages --dry-run
promptpile-compress compress -d ./messages
promptpile-compress restore -d ./messages --dry-run
promptpile-compress restore -d ./messages
```

Compression is reversible: older conversation artifacts move into an Archive
Protocol directory and can be restored byte-for-byte. Cooperating lifecycle
writers use a per-directory lock, and dry-run planning never invokes an
external semantic-summary provider.

For layered Conversation I/O, pass only the writable output directory. Input
layers are immutable context and are not part of a joint compression lifecycle:

```bash
promptpile-compress compress -d ./session-conversation
promptpile-compress restore -d ./session-conversation
```

Compression, archives, summaries, recovery state, and locks remain local to
that one physical directory.

## API

```js
const {
  compressDirectory,
  restoreArchivedTurns,
  runCompressionBeforeCompletion,
} = require('promptpile-compress');
```

The default archive-pointer summary is deterministic and offline. Semantic
summaries require an explicitly injected provider. Automated callers should
use `runCompressionBeforeCompletion()` so compression completes and releases
its lifecycle lock before the completion callback starts. Its trigger decision
is made from the authoritative live Conversation while holding that lock. A
healthy compact Conversation below the trigger is left byte-for-byte unchanged:
no archive restore, provider call, or recompression occurs.

### Beta migration: operation report v2

`runCompressionBeforeCompletion()` now returns `CompressionOperationReport`
version 2. Callers must remove `plan`/`estimate_plan`, rename the `compress`
phase to `maintain_context`, consume the discriminated `decision` and `commit`
unions, allow `selection` to be absent for automatic gate skips, and read the
required `archivesRestored` field. Archive Protocol v1, `compression.json` v1,
manual `compressDirectory()` restore-first behavior, and manual dry-run behavior
are unchanged.

See the
[package documentation](https://github.com/lithdoo/promptpile/tree/main/packages/promptpile-compress)
and
[Archive Protocol](https://github.com/lithdoo/promptpile/blob/main/doc/15-contracts/archive-protocol-v1.md)
for the current contracts and limitations.
