# promptpile-protocol

Pure TypeScript executable projection of stable Promptpile public protocol semantics.

Current public domains are `conversation`, `fingerprint`, `tool`, and `receipt`, plus the Completion Receipt v1 schema export. The package is CommonJS, supports Node.js 18 and newer, performs no I/O on import, has no runtime dependencies, and does not own filesystem, execution, configuration, orchestration, or lifecycle policy.

Normative human contracts live under [`doc/15-contracts`](../../doc/15-contracts/README.md). Package ownership and the protocol admission boundary are documented in [`doc/20-packages/promptpile-protocol.md`](../../doc/20-packages/promptpile-protocol.md).
