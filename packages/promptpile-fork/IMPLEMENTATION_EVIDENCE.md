# Conversation Fork v1 implementation evidence

Status: implementation complete; final Freeze is gated only on the committed dedicated CI matrix.

## Ownership and protocol

- `promptpile-fork` is an independent CLI package with no public library entry point.
- `test/architecture.cjs` enforces the exact `promptpile-protocol` dependency and rejects sibling
  `src/*` or `dist/*` imports.
- Conversation lexical classification and ordering come from `promptpile-protocol/conversation`.
- Canonical fingerprint encoding, digest, and token parsing come from
  `promptpile-protocol/fingerprint`; protocol golden vectors and packed-surface tests protect the
  frozen encoding.
- Promptpile's filesystem observer remains in `promptpile`, and its canonical encoding regression
  tests pass against the public primitive.

## Selection, observation, and reports

- `test/scanner-paths.cjs` covers inclusive selection, same-index sidecars, leading-zero and role
  casing preservation, non-protocol entries, nested files, invalid parents, target existence, and
  path overlap.
- `test/dry-run-cli.cjs` covers CLI parsing, JSON purity, planned reports, fingerprint generation,
  and zero filesystem mutation.
- Empty selection and malformed recognized artifacts are covered by `test/operation.cjs`.

## Copy, concurrency, and publication

- Selected source artifacts are opened without following symlinks where the platform provides
  `O_NOFOLLOW`, streamed byte-exactly to exclusive staging files, and checked against baseline
  length and SHA-256 during the copy.
- Staging is independently rescanned twice and compared with the baseline before publication.
- The source selected prefix is independently re-observed before publication. Changes at or below
  the cutoff fail; append above the cutoff succeeds.
- A canonical-target exclusive claim serializes cooperating writers. `test/contention.cjs` proves
  exactly one winner and that the loser cannot remove the winner's claim.
- The only public commit point is the same-parent staging-directory rename.

## Failure and crash boundary

- `test/operation.cjs` injects failures at every required pre-publication hook and proves the final
  target remains absent. It also covers staging verification failure and publication failure.
- A post-publication injected failure and claim cleanup failure remain successful with warnings.
- `test/crash-boundary.cjs` uses real child-process termination to prove a crash before rename leaves
  the target absent and a crash after rename leaves a complete target. Residual private staging and
  claim behavior matches the v1 crash contract.
- Source byte snapshots are checked across success and failure paths.

## Packaging and compatibility

- `test/package-surface.cjs` packs protocol and fork tarballs, installs them into an independent
  temporary project, runs `--help`, and performs a real fork through the packed binary.
- `test/promptpile-compatibility.cjs` proves a published target is directly readable by Promptpile
  and has the reported selected-prefix fingerprint.
- Root `npm test` includes protocol, Promptpile, Fork, and all sibling package regressions.
- `.github/workflows/conversation-fork.yml` defines the required Node 18/22 by Ubuntu/Windows matrix
  from a clean `npm ci --ignore-scripts` workspace.
- The npm beta publish workflow includes `promptpile-fork` after its protocol prerequisite.

## Local verification on 2026-08-12

The following passed on Windows with Node 22:

```text
npm test -w promptpile-protocol
npm test -w promptpile-fork
node packages/promptpile-fork/test/promptpile-compatibility.cjs
npm test
git diff --check
```

Final Freeze action: after all four jobs in `Conversation Fork v1` pass for the committed revision,
change the plan status to `v1 已实施 / Freeze 完成` and check the acceptance checklist. CI evidence
must not be claimed before it exists.
