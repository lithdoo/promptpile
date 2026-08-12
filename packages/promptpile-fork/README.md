# promptpile-fork

`promptpile-fork` creates an independent physical snapshot of a selected prefix of one Promptpile
Conversation directory. It does not call a model, parse message bodies, copy archive history, or
materialize layered Conversations.

```bash
promptpile-fork \
  --source ./messages \
  --target ./branches/experiment-a \
  --through-index 12
```

The cutoff is inclusive. Every direct regular Conversation Protocol artifact whose numeric index is
less than or equal to the cutoff is copied with its exact basename and raw bytes. This includes all
recognized sidecars at the cutoff. Nested files, symlinks, locks, temporary files, archive data, and
other non-protocol entries are ignored. Recognized malformed JSON or JSONL is copied unchanged.

The source is read-only and may continue growing above the cutoff without invalidating the fork. A
change inside the selected prefix aborts publication. The target parent must already exist and the
target itself must not exist; overwrite, merge, hardlink, archive, and layered modes are deliberately
not supported.

## CLI

```text
--source <dir>        required source physical Conversation directory
--target <dir>        required new target directory
--through-index <n>   required inclusive non-negative safe-integer cutoff
--dry-run             validate, observe, and report without filesystem mutation
--format text|json    output format; default text
```

JSON reports use `sourcePrefixFingerprint`, which fingerprints only the selected prefix. A dry-run
report has `status: "planned"`; a published fork has `status: "completed"`. JSON failures have
`status: "failed"` and a stable machine-readable `code`.

## Publication and crash boundary

Artifacts are copied into a private staging directory beside the target, rescanned and verified, and
the selected source prefix is observed again. Publication consists of one same-parent directory
rename. Before that rename the final target is absent; after it the target is complete.

A caught failure performs best-effort cleanup without replacing the primary error. A process crash
may leave `.promptpile-fork.staging.*` or `.promptpile-fork.claim.*` entries. Version 1 intentionally
does not reclaim stale entries automatically. Failure to release a claim after successful publication
is reported as a warning and does not turn a completed fork into a failure.

The frozen lifecycle and acceptance contract is in
[CONVERSATION_FORK_PLAN.md](./CONVERSATION_FORK_PLAN.md).
