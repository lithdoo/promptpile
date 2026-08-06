# 仓库布局

> 层级：30 · Development  
> 状态：Reference  
> 稳定程度：Evolving  
> 主要定义：当前 monorepo 的工程组织方式  
> 最近复核：2026-08-06

```text
promptpile/
├── packages/
│   ├── promptpile/
│   ├── promptpile-react/
│   ├── promptpile-mcp/
│   ├── promptpile-compress/
│   ├── promptpile-compress-grep-search/   # active read-only archive reader
│   └── promptpile-plan/
├── agent-lite-tools/
├── examples/
├── doc/
└── .github/workflows/
```

根 `package.json` 使用 npm workspaces：`packages/*` 与 `agent-lite-tools/*`。Compress producer 与 grep-search reader 都是 active workspace packages，并进入 root build/test 与 CI gate。

## 开发命令

```bash
npm ci
npm run build
npm test
npm run build:agent-tools
npm run test:agent-tools
npm run docs:build
```

Package 布局属于 implementation，不是 architecture。未来即使拆仓、换包管理器或调整 workspace，也不应改变 [系统架构](../10-architecture/system-overview.md) 与 [正式契约](../15-contracts/README.md)。
