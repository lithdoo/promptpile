# promptpile

Promptpile is a **file-native, CLI-first lightweight agent runtime ecosystem**. Conversation state lives in inspectable files; one `promptpile` invocation performs one Chat Completions request; orchestration, tool execution, compression and archive retrieval are composed outside the core through public CLI and versioned artifacts.

**Documentation:** https://lithdoo.github.io/promptpile/

```text
                     orchestration
             promptpile-react / promptpile-plan
                         │ CLI
                         ▼
                    promptpile
                    │       │
              artifacts     LLM API
                    │
          ┌─────────┴───────────────┐
          │                         │
   promptpile-mcp          context lifecycle
   tool execution          │
                           ├─ promptpile-compress
                           │    compress / restore
                           │
                           └─ Archive Protocol
                                └─ promptpile-compress-grep-search
                                   read-only archive reader
```

Layered Conversation I/O separates immutable context from the writable session:

```text
base / reference layers ──read──┐
                               ├─► promptpile / promptpile-react
session output layer ──read/write┘           │
                                             ├─► promptpile-mcp (calls/results)
                                             ├─► promptpile-compress (lifecycle)
                                             └─► promptpile-archive (read-only history)
```

The output directory is the handoff boundary for downstream tools. MCP execution, compression/restore, and archive retrieval each receive that one physical directory (or an exact calls file); they do not jointly scan all input layers.

## Packages and projects

| Component | Role | Status |
| --- | --- | --- |
| [`promptpile`](./packages/promptpile/) | File-driven single-completion CLI | Beta / active |
| [`promptpile-react`](./packages/promptpile-react/) | ReAct orchestration over the public CLI | Beta / active |
| [`promptpile-mcp`](./packages/promptpile-mcp/) | MCP gateway, tool export and call execution | Beta / active |
| [`promptpile-compress`](./packages/promptpile-compress/) | Conversation compression / restore; Archive Protocol producer/restore implementation | Beta |
| [`promptpile-compress-grep-search`](./packages/promptpile-compress-grep-search/) | Read-only Archive Protocol reader and literal search CLI | Beta |
| [`promptpile-plan`](./packages/promptpile-plan/) | Plan-and-execute orchestration | Scaffold |
| [`agent-lite-tools`](./agent-lite-tools/) | Supporting file/search/shell/web tool packages | Supporting |

## Architecture rules

- Message and tool shapes currently follow OpenAI Chat Completions.
- `promptpile` does **not** execute model-generated tools and does not automatically run a second completion.
- `promptpile-react` integrates only through documented CLI/stdin/artifacts; it does not import `promptpile/dist/*` internals or assume a fixed build path.
- Layered completion has one writable output directory; downstream mutators operate only on that directory or an exact artifact path.
- `promptpile-compress` owns lifecycle mutation, not history-search implementations.
- Archive readers consume the documented Archive Protocol and must not depend on `promptpile-compress` private code.
- Cross-package compatibility is documented as versioned contracts under [`doc/15-contracts`](./doc/15-contracts/README.md).

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

The VitePress site is built from [`doc/`](./doc/) and deployed from `main` to GitHub Pages by GitHub Actions.

## Examples

- [`promptpile-chat-loop`](./examples/promptpile-chat-loop/) — basic multi-round chat loop.
- [`promptpile-mcp-launcher`](./examples/promptpile-mcp-launcher/) — local MCP stdio gateway.
- [`promptpile-mcp-react`](./examples/promptpile-mcp-react/) — ReAct loop backed by the MCP gateway.

## License

ISC
