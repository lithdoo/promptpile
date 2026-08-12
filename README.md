# promptpile

Promptpile is a **file-native, CLI-first lightweight agent runtime ecosystem**. Conversation state lives in inspectable files; one `promptpile` invocation performs one Chat Completions request; orchestration, tool execution, snapshotting, compression and archive retrieval are composed outside the core through public CLI and versioned artifacts.

**Documentation:** https://lithdoo.github.io/promptpile/

```text
                     orchestration
             promptpile-react / promptpile-plan
                         │ public CLI
                         ▼
                    promptpile
                    │       │
              artifacts     LLM API
                    │
     ┌──────────────┼────────────────────┐
     │              │                    │
promptpile-fork  promptpile-mcp    context lifecycle
 snapshot        tool execution     │
                                   ├─ promptpile-compress
                                   └─ Archive Protocol
                                        └─ promptpile-compress-grep-search
```

`promptpile-protocol` is the pure executable projection of stable Conversation, Fingerprint, Tool and Receipt protocol semantics. It is shared by runtime packages but owns no filesystem, model execution, orchestration or lifecycle policy.

Layered Conversation I/O separates immutable context from the writable session:

```text
base / reference layers ──read──┐
                               ├─► promptpile / promptpile-react
session output layer ──read/write┘           │
                                             ├─► promptpile-mcp (calls/results)
                                             ├─► promptpile-compress (lifecycle)
                                             └─► promptpile-fork (explicit physical snapshot)
```

## Packages and projects

| Component | Role | Status |
| --- | --- | --- |
| [`promptpile-protocol`](./packages/promptpile-protocol/) | Pure protocol parser/types/schema projection | Beta / v1 surface stable |
| [`promptpile`](./packages/promptpile/) | File-driven single-completion CLI | Beta / active |
| [`promptpile-fork`](./packages/promptpile-fork/) | Byte-exact Conversation prefix snapshot | Beta / Fork v1 frozen |
| [`promptpile-react`](./packages/promptpile-react/) | ReAct orchestration + structured Agent Event stream | Beta / active, event v1 frozen |
| [`promptpile-mcp`](./packages/promptpile-mcp/) | MCP gateway, tool export and call execution | Beta / active |
| [`promptpile-compress`](./packages/promptpile-compress/) | Conversation compression / restore; Archive Protocol producer | Beta |
| [`promptpile-compress-grep-search`](./packages/promptpile-compress-grep-search/) | Read-only Archive Protocol reader/search | Beta |
| [`promptpile-plan`](./packages/promptpile-plan/) | Plan-and-execute orchestration | Scaffold |
| [`agent-lite-tools`](./agent-lite-tools/) | Supporting file/search/shell/web tool packages | Supporting |

## Architecture rules

- `promptpile` performs exactly one Chat Completions request per root invocation, does not execute model-generated tools, and does not automatically run a second completion.
- `promptpile-react` integrates through documented CLI/stdin/artifacts; `stream-json` emits Agent Event Protocol v1 and does not expose Thought/Observe/Check content.
- `promptpile-fork` reads one physical Conversation source and publishes an independent selected-prefix snapshot through one terminal directory rename.
- `promptpile-protocol` contains only pure public protocol semantics; runtime/lifecycle ownership remains in its packages.
- Layered completion has one writable output directory; downstream mutators operate only on that directory or an exact artifact path.
- Archive readers consume the documented Archive Protocol and must not depend on `promptpile-compress` private code.
- Cross-package compatibility is documented under [`doc/15-contracts`](./doc/15-contracts/README.md).

## Development

```bash
npm ci
npm run build
npm test
npm run build:agent-tools
npm run test:agent-tools
```

Repository development requires Node.js 20 or newer. Independently published packages may declare a lower baseline where their own runtime dependency graph supports it.

## Documentation

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

The VitePress site is built from [`doc/`](./doc/) and deployed from `main` to GitHub Pages. Current architecture/contracts/packages are the documentation truth; completed migration/freeze plans are retained only in Git history.

## Examples

- [`promptpile-chat-loop`](./examples/promptpile-chat-loop/) — basic multi-round chat loop.
- [`promptpile-mcp-launcher`](./examples/promptpile-mcp-launcher/) — local MCP stdio gateway.
- [`promptpile-mcp-react`](./examples/promptpile-mcp-react/) — ReAct loop backed by the MCP gateway.

## License

ISC
