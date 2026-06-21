# promptpile

Promptpile ecosystem monorepo, migrated from [lithdoo/hostra](https://github.com/lithdoo/hostra) at source commit `03d9e9e`.

| Package | Description |
|---|---|
| [promptpile](./packages/promptpile/) | File-driven Chat Completions CLI |
| [promptpile-mcp](./packages/promptpile-mcp/) | MCP stdio gateway, tool export and calls execution |
| [promptpile-react](./packages/promptpile-react/) | ReAct-style orchestration around the promptpile CLI |
| [promptpile-plan](./packages/promptpile-plan/) | Plan-and-execute scaffold |

## Development

```bash
npm install
npm run build
npm test
```

Node.js 18 or newer is required.

## Current architecture notes

- Message and tool shapes currently follow OpenAI Chat Completions.
- `promptpile-react` still imports selected `promptpile/dist/*` modules; public API decoupling is planned separately.
- This repository can be consumed by other repositories as a Git submodule.

## Examples

- [`promptpile-chat-loop`](./examples/promptpile-chat-loop/) — basic multi-round chat loop.
- [`promptpile-mcp-launcher`](./examples/promptpile-mcp-launcher/) — local MCP stdio gateway with filesystem, fetch and Playwright servers.
- [`promptpile-mcp-react`](./examples/promptpile-mcp-react/) — ReAct loop backed by the MCP gateway.

Run `npm install` and `npm run build` at the repository root first. MCP examples also require `npm install` in `examples/`.
