# promptpile-mcp

Promptpile 的 MCP session gateway 与 ToolCall artifact executor。需要 Node.js 20+。

```bash
npm install -g promptpile-mcp
promptpile-mcp --help
```

## Quick start

```toml
version = 1

[gateway]
port = 8765

[servers.fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
```

```bash
promptpile-mcp launch --config mcp.toml
promptpile-mcp export-tools --base-url http://127.0.0.1:8765 -o .tools.toml
promptpile --tools-file .tools.toml ...
promptpile-mcp exec-calls --base-url http://127.0.0.1:8765 --input path/to/turn.calls.jsonl
promptpile-mcp check --input path/to/turn.calls.jsonl
```

`exec-calls` 对完整 result 安全跳过，对 partial/invalid result、已有 execution claim 或不确定执行 fail closed。`--overwrite-results` 会真实重执行工具，可能重复不可逆副作用；它不会绕过 execution claim。

配置严格遵循 v1 schema：未知字段、错误类型、非整数 timeout/concurrency、unsupported transport、无效 env 和重复 retry-safe 工具都会立即失败。Gateway 默认只绑定 loopback；共享环境可配置 bearer token。

正式架构与失败模型见：

- [工具执行系统](../../doc/10-architecture/tool-execution-system.md)
- [promptpile-mcp package contract](../../doc/20-packages/promptpile-mcp.md)
- [Tool Artifacts v1](../../doc/15-contracts/tool-artifacts-v1.md)

开发验证：

```bash
npm test -w promptpile-mcp
npm run test:integration -w promptpile-mcp
npm run test:packed -w promptpile-mcp
```
