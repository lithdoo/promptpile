# 测试策略

> 层级：30 · Development  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：Promptpile monorepo 的验证层次  
> 最近复核：2026-08-05

## 四层测试

### 1. Package behavior

每个 active package 测试自身 parser、filesystem、HTTP/MCP、runtime 等行为。Scaffold 在拥有 package metadata 与实现之前不冒充 active package。

### 2. Contract regression

对公开 CLI/profile/conversation/tool artifact 的关键语义做回归测试。Archive Protocol 稳定阶段还需要 producer/consumer conformance fixtures：`promptpile-compress` 写出的 archive 必须能被独立 grep consumer 读取，而 consumer 不 import compress 私有实现。

Context lifecycle 的平台矩阵、发布命令和兼容策略见 [Context lifecycle 发布质量门](./context-lifecycle-quality.md)。

### 3. Architecture guard

例如 React 递归扫描 production TypeScript source，禁止重新引入 `promptpile/dist/*` 私有依赖。Archive consumer 同样有 source guard，禁止依赖 `promptpile-compress/src` 或 `dist/*`。

### 4. Cross-process / cross-package integration

不仅测试 fake CLI，还需要真实边界：React CLI → package `bin` → real Promptpile canonical parser。Archive lifecycle 已覆盖 `compress producer → Archive Protocol → independent reader` 的跨 package integration；后续 grep query 与 restore consumer flow 继续在该边界扩展。

## Pages gate

当前 GitHub Pages workflow 对 active npm packages 执行安装、build 与 test，再验证 supporting agent tools，最后执行：

```text
npm run docs:build
→ upload Pages artifact
→ deploy
```

`promptpile-compress-grep-search` 已加入 package metadata、root lockfile 与 Pages CI workspace 安装/验证，并由 context lifecycle matrix 在 Windows/Ubuntu、Node 18/22 上共同验证 producer 与 consumer。
