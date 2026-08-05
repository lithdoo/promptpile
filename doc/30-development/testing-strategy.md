# 测试策略

> 层级：30 · Development  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：Promptpile monorepo 的验证层次  
> 最近复核：2026-08-05

## 四层测试

### 1. Package behavior

每个 active package 测试自身 parser、filesystem、HTTP/MCP、runtime 等行为。

### 2. Contract regression

对公开 CLI/profile/conversation/tool artifact 的关键语义做回归测试，防止实现重构改变 contract。

### 3. Architecture guard

例如 React 递归扫描 production TypeScript source，禁止重新引入 `promptpile/dist/*` 私有依赖。

### 4. Cross-process integration

不仅测试 fake CLI，还需要真实边界：React CLI → package `bin` → real Promptpile canonical parser。当前已覆盖 missing profile、非法 temperature/extra-body、missing API-key env 等错误路径，并检查 secret 不泄漏。

## Pages gate

GitHub Pages workflow 在发布文档前执行：

```text
npm ci
→ npm run build
→ npm test
→ npm run build:agent-tools
→ npm run test:agent-tools
→ npm run docs:build
```

因此线上文档只从能通过当前仓库验证的 main commit 发布。
