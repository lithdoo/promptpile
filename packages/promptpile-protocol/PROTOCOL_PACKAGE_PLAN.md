# Promptpile Protocol Schema Package 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：建立极小、无运行时副作用的公共协议包，统一 artifact 名称和纯数据 schema

## 1. 动机

`promptpile`、React、MCP、Compress 和 grep-search 都会解析 Conversation/Tool/Archive artifacts。规则分散会造成 filename、排序、calls/result 配对和 JSON 类型漂移。此前曾否决庞大的 `promptpile-core`；本提案不是恢复该方向，而是只共享稳定的纯协议定义。

## 2. 包边界

候选包名：

```text
promptpile-protocol
```

允许包含：

- artifact filename parser/formatter；
-纯数据 TypeScript 类型；
- JSON Schema；
-规范化排序键；
- receipt schema；
- fingerprint 规范编码 helper；
- tool calls/result line 的纯校验器。

禁止包含：

- filesystem I/O；
- CLI parser；
- config/TOML；
- LLM client；
- process spawning；
- MCP transport；
- compression policy；
- Dayloom 或其它宿主业务类型。

## 3. API 原则

示例：

```ts
parseConversationArtifactName(name: string): ParsedArtifactName | null;
formatAssistantArtifactName(index: number, kind: AssistantArtifactKind): string;
compareConversationArtifacts(a: ArtifactRef, b: ArtifactRef): number;
validateCompletionReceipt(value: unknown): CompletionReceiptV1;
```

API 必须是纯函数，输入输出可序列化，不读取环境或全局状态。

## 4. 版本策略

- 每个磁盘协议对象继续带自己的 schema version。
- npm package semver 不等同于 Conversation Protocol version。
- 添加可选字段可以按兼容规则演进；改变 filename 或排序语义需要新的协议版本/ADR。
- 消费者必须显式选择支持的 schema version，不能静默猜测未来格式。

## 5. 迁移策略

第一阶段不强制所有包立刻依赖新包：

1. 用现有 fixture 为协议行为建立 golden tests。
2. 创建 package 并迁移最无争议的 filename parser/formatter。
3. `promptpile` 成为参考实现消费者。
4. MCP/Compress/grep-search 按价值逐步切换。
5. 删除重复实现前验证行为完全一致。

## 6. 非目标

- 不导出 Promptpile completion runtime。
- 不创建跨包 service container 或插件框架。
- 不让 React import Promptpile 私有业务实现。
- 不统一各包本来不同的生命周期和错误类型。
- 不把所有文档协议都强行塞进第一版。

## 7. 测试

- filename parser/formatter round trip；
-大小写、非法 idx、专用 sidecar、未知扩展；
-排序 golden fixtures；
-JSON Schema 正反例；
-跨包 compatibility fixtures；
-browser-free、Node 版本和零副作用 import 测试。

## 8. 验收标准

- 包不依赖 Node filesystem、child_process、LLM 或 MCP SDK。
- `promptpile` 的协议行为不因迁移改变。
- 至少两个独立包使用同一 parser/schema，证明它不是无消费者抽象。
- 包体积和依赖保持极小。
- ADR 明确其与被否决的 `promptpile-core` 的区别。

## 9. 待定项

- 是否一个包覆盖 Conversation/Tool/Archive，还是从 Conversation artifact names 开始。
- 使用手写 validator、JSON Schema validator 还是 Zod；应避免引入重量依赖。
- CommonJS/ESM 双发布策略。
- schema 文件如何让非 TypeScript 宿主使用。
