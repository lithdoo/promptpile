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
its lifecycle lock before the completion callback starts.

See the
[package documentation](https://github.com/lithdoo/promptpile/tree/main/packages/promptpile-compress)
and
[Archive Protocol](https://github.com/lithdoo/promptpile/blob/main/doc/15-contracts/archive-protocol-v1.md)
for the current contracts and limitations.
