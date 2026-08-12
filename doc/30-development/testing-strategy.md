# 测试策略

> 层级：30 · Development  
> 状态：Reference  
> 稳定程度：Evolving  
> 主要定义：Promptpile monorepo 的 executable evidence 层次  
> 最近复核：2026-08-12

## 五层证据

### 1. Package behavior

每个 active package 测试自己的 parser、filesystem transaction、HTTP/MCP、runtime FSM 等内部行为。Scaffold 不冒充 active runtime。

### 2. Protocol/schema conformance

公开 machine contract 需要 parser/schema/fixture evidence：

- `promptpile-protocol` 验证 Conversation/Fingerprint/Tool/Receipt 纯投影和 package surface；
- Completion Receipt schema 与 producer 保持 conformance；
- React Agent Event schema 验证 frozen 6-event vocabulary、payload shape 与 additive optional-field compatibility；
- Archive producer/consumer 使用独立 package boundary 验证 protocol interoperability。

### 3. Architecture guards

Source guards 防止 ownership 回流，例如：

- React production source 禁止依赖 `promptpile/src/*` / `dist/*`；
- protocol package 禁止 runtime imports/side effects；
- archive consumer 禁止依赖 compress 私有实现；
- fork 将 filesystem transaction 留在自身，不把它导入 protocol。

### 4. Adversarial state-machine tests

涉及 durable publication 的能力必须测试 failure boundary，而不只测试 happy path：

- Promptpile：OCC contention、truncated/malformed stream、reserved request fields、hook failure、Receipt ordering；
- Fork：source instability、target contention、staging exact-set、crash boundary、dry-run zero mutation；
- React streaming：malformed/incomplete Final private stream、child non-zero、terminal uniqueness、stdout ownership/EPIPE。

### 5. Cross-process / packed integration

真实边界必须覆盖 packaged artifact，而不仅是假 CLI：React → installed Promptpile；Fork → protocol；Compress producer → independent archive reader。packed fresh-install smoke 用于证明 package metadata、exports/bin 和 runtime dependencies 与发布产物一致。

## CI matrix

不同 package 可以声明不同 Node baseline；matrix 必须与各自 `engines` 和 runtime dependency graph 一致。当前 core/React publication gates 使用 Node 20/22，Protocol/Fork 保留 Node >=18 package baseline 并有对应兼容证据。

Pages workflow 在发布文档前执行 active workspace validation，再执行：

```text
npm run docs:build
→ upload Pages artifact
→ deploy
```

文档中的“已通过”结论只应来自实际 CI/run evidence；测试文件存在本身不等于某个 commit 的 CI 已 green。
