# promptpile

Promptpile is a **file-native, CLI-first lightweight agent runtime ecosystem**. Conversation state lives in inspectable files; one `promptpile` invocation performs one Chat Completions request; orchestration and tool execution are composed outside the core through public CLI and artifacts.

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
          ┌─────────┴──────────┐
          │                    │
   promptpile-mcp      promptpile-compress
   tool execution       context lifecycle
```

## Packages

| Package | Role | Status |
| --- | --- | --- |
| [`promptpile`](./packages/promptpile/) | File-driven single-completion CLI | Beta / active |
| [`promptpile-react`](./packages/promptpile-react/) | ReAct orchestration over the public CLI | Beta / active |
| [`promptpile-mcp`](./packages/promptpile-mcp/) | MCP gateway, tool export and call execution | Beta / active |
| [`promptpile-compress`](./packages/promptpile-compress/) | Conversation compression / restore / retrieval | Experimental / private |
| [`promptpile-plan`](./packages/promptpile-plan/) | Plan-and-execute orchestration | Scaffold |
| [`agent-lite-tools`](./agent-lite-tools/) | Supporting file/search/shell/web tool packages | Supporting |

## Architecture rules

- Message and tool shapes currently follow OpenAI Chat Completions.
- `promptpile` does **not** execute model-generated tools and does not automatically run a second completion.
- `promptpile-react` integrates only through documented CLI/stdin/artifacts; it does not import `promptpile/dist/*` internals or assume a fixed build path.
- Cross-package compatibility is documented as versioned contracts under [`doc/15-contracts`](./doc/15-contracts/README.md).

## Development

```bash
npm ci
npm run build
npm test
npm run build:agent-tools
npm run test:agent-tools
```

Node.js 18 or newer is required.

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
