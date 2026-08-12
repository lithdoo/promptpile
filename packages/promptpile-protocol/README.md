# promptpile-protocol

Pure, dependency-free TypeScript projection of stable Promptpile protocol schemas and artifact conventions.

Status: v1 implemented. Public domains are `conversation`, `tool`, `receipt`, and the Completion Receipt v1 schema export.

The package is CommonJS, supports Node.js 18 and newer, performs no I/O on import, and has no runtime dependencies. Filesystem discovery, mutation, execution, configuration, orchestration, and lifecycle policy remain with their owning packages.

See [PROTOCOL_PACKAGE_PLAN.md](./PROTOCOL_PACKAGE_PLAN.md) for the frozen design and acceptance criteria.
