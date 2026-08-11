# Promptpile Protocol Package 实施计划

> 状态：实施前冻结稿  
> 日期：2026-08-12  
> 目标包：`packages/promptpile-protocol`  
> 核心结论：建立极小、无运行时副作用、零 runtime dependency 的公共协议投影包；只接纳已经稳定、可纯函数/纯数据表达、且存在真实跨包复用价值的协议语义。

## 0. 最终架构结论

`promptpile-protocol` 不是新的 `promptpile-core`，也不是共享 runtime 工具箱。它只负责把已经冻结或足够稳定的公共协议，投影成可被多个 package 共同消费的纯 TypeScript API、纯 parser/formatter/comparator 和 machine-readable schema。

```text
doc/15-contracts/
    │ normative human semantics
    ▼
repo-level conformance fixtures
    │ executable examples / golden corpus
    ▼
promptpile-protocol
    │ pure executable projection
    ▼
producer / consumer packages
```

核心准入定理：

```text
一个语义进入 promptpile-protocol
⇒ 它已经是公共协议
⇒ 可以用纯数据或纯函数表达
⇒ 不拥有 runtime/lifecycle 副作用
⇒ 有 normative contract
⇒ 有 conformance fixture
⇒ 有真实 producer/consumer 复用价值
```

反向边界：

```text
需要 fs / realpath / cwd / env / CLI / TOML / lock / spawn / model / commit
⇒ 不属于 promptpile-protocol
```

## 1. 动机

`promptpile`、`promptpile-mcp`、`promptpile-react`、`promptpile-compress`、`promptpile-compress-grep-search` 和未来 `promptpile-fork` 都会接触 Conversation、Tool、Receipt 或 Archive 等公共 artifact。若 filename、idx、安全整数域、排序、calls/result shape 和 JSON schema 在各 package 中重复实现，长期会产生：

- filename grammar 漂移；
- Windows/Linux 排序差异；
- safe-integer 边界不一致；
- calls/result 类型和 validator 漂移；
- Receipt TypeScript type 与 JSON Schema 漂移；
- consumer import producer 私有 `src/*` / `dist/*`；
- 为了复用少量协议语义而引入整个 runtime package。

本包只解决这些**纯协议重复**，不统一各 package 的生命周期、错误模型或 orchestration。

## 2. Ownership invariant

### 2.1 允许进入协议包

允许：

- artifact basename parser / canonical formatter；
- Conversation idx domain；
- UTF-8 byte lexical ordering helper 或基于该规则的纯 comparator；
- 纯数据 TypeScript types；
- Tool calls/result 的纯 shape parser；
- Completion Receipt v1 public types；
- Completion Receipt v1 JSON Schema 的发布副本；
- 无 I/O 的 conformance helper。

### 2.2 永久禁止进入协议包

禁止：

- filesystem discovery / read / write；
- `path.resolve`、realpath、canonical directory identity；
- Conversation scanner 的目录遍历；
- next-index filesystem allocator；
- OCC claim、lock、CAS、atomic writer；
- CLI parser、Commander、config/TOML；
- `process.argv`、`process.env`、cwd；
- LLM client、HTTP、streaming transport；
- process spawning、after-hook executor；
- Completion Artifact Ledger；
- Completion Receipt builder / atomic commit；
- MCP transport / tool execution；
- compression / restore lifecycle；
- React orchestration / child-process lifecycle；
- Dayloom 或其它宿主业务类型。

协议包不得为了“方便 consumer”逐步吸收上述 runtime helper。

## 3. Protocol maturity gate

协议包不是所有“看起来像协议”的内容的默认归宿。每个 domain 必须满足成熟度门槛后才能进入 public exports。

| Domain | 当前成熟度 | v1 extraction | 结论 |
| --- | --- | --- | --- |
| Conversation idx / filename / ordering | Normative / Evolving | **纳入** | lexical semantics 已明确且已有多处复用价值 |
| Tool calls / result pure shapes | Normative / Evolving | **纳入** | `promptpile` 与 `promptpile-mcp` 已形成独立 producer/consumer |
| Completion Receipt public type/schema | v1 Freeze | **纳入** | machine contract 已冻结 |
| Conversation Fingerprint encoding | 已冻结但主要单 owner | **暂缓** | 等第二独立 consumer 真正需要 canonical encoding |
| Archive Protocol | Experimental | **暂缓** | 提升到 Normative/Stable 后再准入 |
| React Agent Event Protocol | React design domain | **不纳入 v1** | ownership 保持在 `promptpile-react` |
| OCC / hook / ledger / atomic | Runtime semantics | **永久排除** | 不属于纯协议投影 |

“一个 package 覆盖 Conversation/Tool/Archive 还是拆包”不再是待定项：使用**一个极小 package + 明确 domain subpath**，但只有达到 maturity gate 的 domain 才能进入。

## 4. v1 最小范围

v1 只实现三个 public domain：

```text
promptpile-protocol/conversation
promptpile-protocol/tool
promptpile-protocol/receipt
```

第一轮不实现：

```text
promptpile-protocol/archive
promptpile-protocol/fingerprint
promptpile-protocol/react
```

也不创建 generic `core`、`utils`、`runtime`、`filesystem` subpath。

## 5. Package 与模块格式

### 5.1 v1 使用 CommonJS

当前主要 producer/consumer package 均以 CommonJS 发布。v1 固定使用 CommonJS，不在第一版引入 ESM/CJS dual-package hazard。

未来若需要 ESM，单独做 package-format compatibility 设计，不与协议语义迁移混在同一变更中。

### 5.2 runtime dependency 必须为 0

发布后的：

```json
"dependencies": {}
```

必须为空。

允许 dev/test dependency，例如 TypeScript、Ajv；这些依赖不得进入运行时 dependency graph。

### 5.3 subpath exports

建议最终 package surface：

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./conversation": "./dist/conversation.js",
    "./tool": "./dist/tool.js",
    "./receipt": "./dist/receipt.js",
    "./schemas/completion-receipt-v1.json": "./dist/schemas/completion-receipt-v1.json"
  }
}
```

根 `index` 只允许无逻辑 re-export 已冻结 domain，不允许成为杂项 helper 聚集地。内部 package 应优先使用明确 subpath import。

禁止 public consumer import：

```text
promptpile-protocol/dist/*
promptpile-protocol/src/*
```

## 6. Source-of-truth model

### 6.1 人类语义

`doc/15-contracts/*` 继续是 normative human contract，不因为创建 npm package 而把协议意义转移到 TypeScript 注释中。

### 6.2 Conformance corpus

建立 repo-level canonical fixtures，例如：

```text
fixtures/conversation-protocol-v1/
fixtures/tool-artifacts-v1/
fixtures/completion-receipt-v1/
```

Producer、consumer 和 protocol package 共享同一 corpus，不复制 package-local “等价 fixture”。

### 6.3 JSON Schema

Completion Receipt 的 normative schema 文件继续以：

```text
doc/15-contracts/completion-receipt-v1.schema.json
```

为 source of truth。

`promptpile-protocol` build 将它 byte-for-byte 复制到 npm `dist/schemas/`，测试必须验证发布副本与 normative schema 完全一致。

当前 `promptpile` 若需要继续发布兼容 schema 路径，可以从同一 normative source 继续复制；Protocol migration 不借机破坏已有 package path。

## 7. Conversation v1 public API

第一批抽取必须优先选择现有实现中已经是纯语义的部分，而不是整文件搬迁。

当前 `conversation-index.ts` 同时包含纯 idx parser 和 filesystem allocator；只有纯 parser/domain 常量进入协议包，allocator 留在 `promptpile`。

当前 `conversation-artifact-name.ts` 已接近纯 parser，但必须去掉对 `promptpile` 私有 `types.ts` 的依赖后再迁移。

### 7.1 idx domain

建议 API：

```ts
export const MAX_CONVERSATION_INDEX_V1 = Number.MAX_SAFE_INTEGER;

export function parseConversationIndexV1(
  raw: string
): number | undefined;
```

冻结语义：

- 只接受 ASCII decimal digits：`^\d+$`；
- 结果必须是 `Number.isSafeInteger(index) && index >= 0`；
- 不 trim；
- 不接受 sign、decimal point、scientific notation；
- leading zero 合法，因此 `"01" -> 1`；
- 超出安全整数范围返回 `undefined`；
- parser 不 throw。

为了迁移最小化，返回 `undefined` 与当前 `promptpile` pure parser 保持一致，不为了新包引入无价值的 `null` adapter。

### 7.2 artifact classifier

建议类型：

```ts
export type ConversationArtifactFileKindV1 =
  | 'message'
  | 'assistant_call'
  | 'assistant_result'
  | 'assistant_extra';

export interface RecognizedConversationArtifactNameV1 {
  idx: number;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  fileKind: ConversationArtifactFileKindV1;
}

export function classifyConversationArtifactNameV1(
  basename: string
): RecognizedConversationArtifactNameV1 | undefined;
```

输入必须是 **basename**。协议包不得调用 `path.basename()` 猜测 caller 意图。

冻结 grammar：

```text
普通 message:
^\[(\d+)\](.+?)\.(md|json)$

special assistant artifacts:
[idx]assistant.calls.jsonl
[idx]assistant.extra.json
[idx]assistant.result.jsonl
```

约束：

- 大小写敏感；
- special names 必须精确小写；
- `[idx]assistant.json` 仍是普通 `message`；
- invalid / unknown / unsafe idx 返回 `undefined`；
- 不 trim、不 Unicode normalize、不 case-fold；
- parser 不访问 filesystem。

### 7.3 canonical assistant formatter

建议 API：

```ts
export type AssistantArtifactKindV1 =
  | 'body'
  | 'calls'
  | 'extra'
  | 'result';

export function formatAssistantArtifactNameV1(
  idx: number,
  kind: AssistantArtifactKindV1
): string;
```

formatter 只接受合法非负 safe integer；非法 programmatic input 应 throw deterministic argument error。

canonical output：

```text
body   -> [N]assistant.md
calls  -> [N]assistant.calls.jsonl
extra  -> [N]assistant.extra.json
result -> [N]assistant.result.jsonl
```

注意 leading zero：

```text
parse("[01]user.md").idx === 1
format(1, ...) 使用 [1]，不保留原 lexical spelling
```

因此只承诺 canonical round-trip：

```text
parse(format(value)) == value
```

不承诺 `format(parse(original))` 与原始 basename byte-for-byte 相同。

### 7.4 deterministic ordering

协议包可以提供纯 comparator，但不得扫描目录。

建议输入：

```ts
export interface ConversationArtifactSortEntryV1 {
  idx: number;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  fileKind: ConversationArtifactFileKindV1;
  relativePath: string;
}

export function compareConversationArtifactsV1(
  a: ConversationArtifactSortEntryV1,
  b: ConversationArtifactSortEntryV1
): number;
```

必须精确实现 Conversation Protocol v1：

1. idx numeric ascending；
2. 同 idx 下普通 message（不含 `[idx]assistant.md`）；
3. `[idx]assistant.md`；
4. calls；
5. extra；
6. result；
7. 同一 bucket 内按协议要求使用 UTF-8 unsigned bytes lexicographic ordering。

禁止 `localeCompare()`、OS locale、case folding 或 Unicode normalization。

Comparator 只比较 caller 提供的纯 artifact facts，不 realpath、不读取文件。

## 8. Tool Artifacts v1 public API

只抽取纯数据 shape 与必要的 dependency-free parser，不抽 tool execution 或 completeness exit-code policy。

建议类型：

```ts
export interface ToolCallV1 {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResultLineV1 {
  tool_call_id: string;
  content: string;
  name?: string;
}
```

建议纯 parser：

```ts
export function parseToolCallV1(
  value: unknown
): ToolCallV1 | undefined;

export function parseToolResultLineV1(
  value: unknown
): ToolResultLineV1 | undefined;
```

parser 必须：

- 不 mutate input；
- 不读取 JSONL 文件；
- 不决定 unknown call id 是否 fatal；
- 不决定 `pending|partial|invalid` 对应进程 exit code；
- 不决定 overwrite / retry；
- 对无效 shape 返回 `undefined`，不输出 diagnostics 到 stderr。

若未来抽取 completeness analyzer，必须保持纯函数：

```text
calls + result values
→ pure structural status
```

CLI exit code 和执行恢复策略仍属于 `promptpile-mcp`。

## 9. Completion Receipt v1 public surface

Completion Receipt 已经是冻结的 machine contract，适合进入 protocol package；但只迁移**public representation**。

允许：

```ts
CompletionUsageV1
CompletionReceiptHookV1
CompletionReceiptV1
```

以及 raw schema：

```text
promptpile-protocol/schemas/completion-receipt-v1.json
```

禁止迁移：

```text
ResolvedInvocationContextV1
CompletionArtifactLedger
AfterHookObservationV1
buildCompletionReceiptHookV1
buildCompletionReceiptV1
commitCompletionReceiptV1
atomicWriteFileSync
```

正确 dependency direction：

```text
promptpile-protocol
      │ public Receipt type/schema
      ▼
promptpile runtime
      │ invocation + ledger + hook decision
      ▼
Receipt builder
      ▼
atomic commit
```

Protocol package 永远不知道 Receipt 是如何生成、何时 commit、如何与 process success 关联的；这些属于 `promptpile` runtime contract。

## 10. Validation strategy

### 10.1 不提供 bundled JSON Schema engine

v1 不提供：

```ts
validateCompletionReceipt(value)
```

原因：

- 引入 Ajv 会破坏 zero runtime dependency；
- 手写完整 Receipt validator 会制造与 JSON Schema 的第二套 authority；
- build-time code generation 会把第一阶段复杂度放大。

因此 v1：

```text
TypeScript consumer -> public types
runtime schema consumer -> raw JSON Schema + caller-selected validator
```

Protocol package 自己可在 dev/test 使用 Ajv 跑正反 fixture，但 Ajv 不能成为 runtime dependency。

### 10.2 小型 lexical validator

Conversation idx/name 和 Tool line shape 等非常小且已经明确的规则，可以使用 handwritten pure parser。每个 parser 必须由 golden fixture 定义输入输出，而不是只靠实现代码自证。

## 11. Fingerprint admission gate

Conversation Fingerprint 现在不进入 v1。

只有满足以下条件才允许抽取：

- 第二个独立 package 真实需要生成或验证 canonical fingerprint encoding；
- canonical binary encoding 已保持冻结；
- 可以把纯 encoder 与 filesystem observation、hash I/O 清晰分离；
- 至少有一个 cross-package byte-for-byte fixture。

即使未来准入，也只允许：

```text
pure canonical record encoder
pure token formatter/parser（若 contract 需要）
```

filesystem scanning、raw-byte reading、stable observation orchestration 继续留在 runtime owner。

## 12. Archive admission gate

Archive Protocol 当前仍处于 Experimental，不进入 protocol package v1 public exports。

准入前必须：

- normative 文档状态提升为至少 Normative/Evolving；
- producer 与独立 read-only consumer 继续通过同一 conformance corpus；
- manifest v1 最小字段和 breaking-change policy 不再处于讨论状态；
- package public API 可以只表达纯 discovery-name / manifest shape，不承担 lifecycle recovery。

即使未来进入：

```text
archive basename grammar
manifest pure type/parser
```

可以属于 protocol；

```text
archive directory discovery
restore
staging recovery
lock handling
filesystem mutation
```

永远留在 lifecycle owner。

## 13. React ownership boundary

Agent Event Protocol v1 的 owner 保持为 `promptpile-react`。

当前不因为它“也是协议”就搬进 `promptpile-protocol`。只有出现真实独立消费者，例如 IDE SDK / UI SDK / 独立 event parser，并且事件 schema 已冻结后，才评估把**纯 event type/schema projection** 纳入 protocol package。

React child-process orchestration、phase execution、stdout writer 和 terminal-event state machine 永远不迁移。

## 14. Zero-side-effect contract

`promptpile-protocol` 的零副作用不是风格建议，而是测试 contract。

### 14.1 禁止 runtime import

production source 禁止 import：

```text
fs
fs/promises
path
child_process
net
http
https
os
promptpile private src/*
promptpile private dist/*
其它 producer private implementation
```

如某个纯 helper 可以使用 ECMAScript/Node 标准无状态 primitive，应优先确认其不引入环境观测；协议实现不应依赖平台路径语义。

### 14.2 顶层 import 不得产生行为

```js
require('promptpile-protocol')
require('promptpile-protocol/conversation')
require('promptpile-protocol/tool')
require('promptpile-protocol/receipt')
```

必须保证：

- 不读 env；
- 不读 cwd；
- 不访问 filesystem；
- 不 spawn；
- 不启动 timer；
- 不注册 signal/process handler；
- 不修改 global；
- 不打印 stdout/stderr。

### 14.3 跨平台确定性

相同 pure input 在 Node 18/22 × Linux/Windows 必须产生完全相同 output，尤其 filename classification 与 UTF-8 byte ordering 不得依赖 OS/ICU locale。

## 15. Dependency rules

允许依赖方向：

```text
promptpile-protocol
      ▲
      ├── promptpile
      ├── promptpile-mcp
      ├── promptpile-compress / grep-search（按需）
      └── future consumers
```

禁止：

```text
promptpile-protocol -> promptpile
promptpile-protocol -> promptpile-mcp
promptpile-protocol -> promptpile-compress
promptpile-protocol -> promptpile-react
```

禁止 consumer 为共享一个 pure type 而重新 import producer 私有实现。

## 16. Versioning 与 compatibility

### 16.1 npm semver 与协议版本独立

```text
promptpile-protocol package version
!= Conversation Protocol version
!= Tool Artifact version
!= Receipt schemaVersion
```

公共 symbol 显式携带 domain version，例如：

```ts
CompletionReceiptV1
ToolResultLineV1
parseConversationIndexV1
```

### 16.2 Breaking change

以下属于 protocol API breaking change：

- 改变 filename recognition；
- 改变 idx domain；
- 改变排序语义；
- 改变 formatter canonical spelling；
- 收紧已接受 Tool public shape；
- 改变 Receipt v1 public representation；
- 删除或改名 public export。

这些不能以“内部重构”名义静默修改。

### 16.3 Additive change

新增独立 pure helper 或为未来协议版本增加新 symbol，可以按 semver 兼容规则处理，但不得改变现有 v1 symbol 的语义。

## 17. 实施阶段

所有阶段都必须保持可独立 review、可独立 revert。禁止一次 PR 同时搬完所有 producer/consumer。

### Phase 0 — scaffold 可构建化

在现有空包基础上新增：

```text
src/
tsconfig.json
scripts/（仅必要 build copy helper）
test/
```

配置 CommonJS build、declaration、subpath exports、`files` whitelist、`npm pack` smoke test。

此阶段**不切任何 consumer**。

验收：

- package build 成功；
- runtime dependencies 为 0；
- import zero-side-effect test 通过；
- npm pack 后只包含预期 dist/schema/README/package metadata。

### Phase 1 — Conversation pure primitives

迁移/重写：

```text
MAX_CONVERSATION_INDEX_V1
parseConversationIndexV1
classifyConversationArtifactNameV1
formatAssistantArtifactNameV1
compareConversationArtifactsV1
```

使用 canonical Conversation fixtures 建立 golden parity。

此阶段 `promptpile` 仍可以继续使用旧实现，两套实现必须对同一 corpus byte/structurally 等价。

### Phase 2 — `promptpile` reference adoption

`promptpile` 改为从 `promptpile-protocol/conversation` 消费 pure primitives。

删除或降级旧 duplicated lexical implementation，但保留：

```text
filesystem scanner
allocator
mutation
Fingerprint observation
OCC
output policy
```

在 runtime owner 内。

必须证明迁移前后：

- scanner recognized artifacts 一致；
- message ordering 一致；
- Fingerprint 一致；
- next-index 行为一致；
- output collision recognition 一致；
- existing package tests 无行为变化。

### Phase 3 — second-consumer proof

至少一个独立 package 必须直接消费同一个 Conversation public primitive，证明 protocol package 不是仅把 `promptpile` 私有 helper 换目录。

优先选择真实需要 lexical classification / formatting 的 read-only consumer；不得为了满足 checklist 人为制造无价值 import。

若当时没有第二真实 consumer，则 Conversation extraction 可以保留 beta，但不能声明整个 protocol package Freeze 完成。

### Phase 4 — Tool pure shapes

迁移 ToolCall / ToolResultLine public shape 与最小 pure parser。

至少 `promptpile` 与 `promptpile-mcp` 共同消费同一 public type/parser；Tool execution、exit code 与 overwrite policy 不迁移。

必须有正反 JSON fixture、duplicate/unknown id 边界由 owner policy 测试继续覆盖。

### Phase 5 — Receipt public representation

迁移/共享：

```text
CompletionUsageV1
CompletionReceiptHookV1
CompletionReceiptV1
raw JSON Schema publication copy
```

`promptpile` builder/commit 继续留在 runtime package。

必须验证：

- protocol published schema 与 normative schema byte-for-byte identical；
- `promptpile` producer 生成的 Receipt 继续通过同一 schema；
- fatal hook impossible-state contract 不因类型迁移放宽；
- Receipt atomic publication / success-only tests 不受影响。

### Phase 6 — monorepo/release integration

根 build/test 顺序加入 protocol：

```text
protocol build/test
→ promptpile
→ dependent consumers
```

发布顺序必须保证 protocol package 先于依赖它的 package 发布。

若 workspace package 使用精确 beta semver，release tooling 必须同步更新依赖版本，避免 npm 安装时引用未发布版本。

### Phase 7 — freeze

满足本文全部 acceptance 后：

```text
状态：v1 已实施 / Freeze 完成
```

在此之前保持 beta，不扩大 scope。

## 18. 推荐目录结构

实施后目标：

```text
packages/promptpile-protocol/
├─ package.json
├─ README.md
├─ PROTOCOL_PACKAGE_PLAN.md
├─ tsconfig.json
├─ src/
│  ├─ index.ts
│  ├─ conversation.ts
│  ├─ tool.ts
│  └─ receipt.ts
├─ scripts/
│  └─ copy-schemas.mjs
├─ test/
│  ├─ conversation.cjs
│  ├─ tool.cjs
│  ├─ receipt-schema.cjs
│  ├─ zero-side-effect.cjs
│  └─ package-surface.cjs
└─ dist/
   └─ ... generated only
```

Canonical cross-package fixtures继续放 repo-level `fixtures/`，不藏在 protocol package 私有测试目录。

## 19. 测试矩阵

### 19.1 Conversation

至少覆盖：

- idx `0`、`1`、`Number.MAX_SAFE_INTEGER`；
- negative/sign/decimal/exponent/empty/whitespace invalid；
- `MAX_SAFE_INTEGER + 1` invalid；
- leading zero；
- ordinary `.md` / `.json`；
- exact special assistant calls/extra/result；
- case-sensitive rejection；
- unknown extension；
- `[idx]assistant.json` 仍为 ordinary message；
- canonical formatter round trip；
- same-idx ordering；
- non-ASCII role/path 按 UTF-8 unsigned bytes 排序；
- 不受 locale 影响。

### 19.2 Tool

至少覆盖：

- valid call；
- valid result with/without `name`；
- missing required field；
- wrong field type；
- nested function invalid；
- parser 不 mutate input；
- unknown additive fields 的策略必须与 normative contract 一致并固定测试。

### 19.3 Receipt

至少覆盖：

- normative schema byte equality；
- valid completed Receipt；
- `invocationId: null`；
- hook success/skip/warn failure；
- failed hook + `failureMode=error` 被 schema 拒绝；
- additional properties contract；
- package export 能被普通 Node consumer 读取。

### 19.4 Architecture

至少覆盖：

- forbidden-import recursive guard；
- zero runtime dependencies；
- no private producer import；
- top-level import no stdout/stderr；
- npm pack content whitelist；
- packed tarball 安装后 subpath import 正常。

## 20. CI

新增 dedicated `Protocol Contract` workflow：

```text
Node 18 × ubuntu-latest
Node 22 × ubuntu-latest
Node 18 × windows-latest
Node 22 × windows-latest
```

每组至少执行：

```text
npm ci
protocol build
protocol unit/golden tests
zero-side-effect / architecture guard
npm pack
packed-package smoke install/import
```

在 producer adoption 后，再加入 representative cross-package compatibility tests。

根 monorepo `build` / `test` 必须包含 protocol package；Protocol 失败时 dependent package 不应靠 stale `dist` 偶然通过。

## 21. Publishing contract

发布包必须：

- public npm package；
- Node `>=18`；
- CommonJS v1；
- declaration files 随包发布；
- runtime dependencies 为 0；
- schema JSON 可通过稳定 export path 获取；
- 不发布 test fixtures、source maps/临时文件，除非后续明确决定 fixtures 也是 public distribution surface。

在第一个外部 consumer 之前保持 beta tag。

## 22. ADR / 防止 `promptpile-core` 回潮

实施时新增一个简短 ADR，必须明确：

```text
promptpile-protocol
= stable pure protocol projection

promptpile-core（被否决方向）
= runtime/config/filesystem/orchestration shared kernel
```

未来任何新增 export 都要回答：

1. 它对应哪一篇 normative contract？
2. 它是否可纯函数/纯数据表达？
3. 它是否需要 runtime/lifecycle ownership？
4. 是否已有至少两个真实调用方或明确的跨包互操作价值？
5. 是否已有 conformance fixture？

若第 2 为否或第 3 为是，则拒绝进入 protocol package。

## 23. Acceptance checklist

### Package boundary

- [ ] CommonJS v1 package 可构建；
- [ ] runtime dependencies = 0；
- [ ] 无 fs/path/process/spawn/network runtime ownership；
- [ ] 无 producer private `src/*` / `dist/*` import；
- [ ] subpath exports 固定；
- [ ] npm pack surface 固定。

### Conversation

- [ ] idx domain 与 Conversation Protocol v1 完全一致；
- [ ] filename classifier parity 完成；
- [ ] canonical assistant formatter 完成；
- [ ] UTF-8 byte ordering parity 完成；
- [ ] `promptpile` 已切为 reference consumer；
- [ ] migration 前后 scanner/Fingerprint/OCC/output behavior 无变化；
- [ ] 至少一个独立第二 consumer 使用同一 Conversation primitive。

### Tool

- [ ] ToolCall/ToolResultLine public shapes 固定；
- [ ] dependency-free pure parser 完成；
- [ ] `promptpile` 与 `promptpile-mcp` 共享同一协议 surface；
- [ ] tool execution / retry / exit-code policy 未进入协议包。

### Receipt

- [ ] Completion Receipt v1 public types 固定；
- [ ] normative JSON Schema 随 protocol package 发布；
- [ ] schema 发布副本 byte-for-byte 一致；
- [ ] `promptpile` builder/commit 仍由 runtime owner 持有；
- [ ] existing Receipt success-only / hook / atomic tests 全绿。

### Deferred-domain guard

- [ ] Archive 未在 Experimental 状态下进入 public exports；
- [ ] Fingerprint 未在无第二真实 consumer 时提前抽取；
- [ ] React Agent Event Protocol ownership 仍在 `promptpile-react`；
- [ ] OCC/hook/ledger/atomic/runtime helper 未进入协议包。

### CI / release

- [ ] Node 18/22 × Linux/Windows dedicated matrix 全绿；
- [ ] root monorepo build/test 纳入 protocol；
- [ ] packed tarball smoke install/import 通过；
- [ ] release 顺序和精确 beta dependency 已验证；
- [ ] 至少两个独立 package 的 cross-package compatibility test 全绿。

## 24. Freeze criteria

只有在以下条件同时成立时，`promptpile-protocol` v1 才可标记 Freeze：

```text
normative docs
+ canonical fixtures
+ pure reference implementation
+ promptpile reference adoption
+ second real consumer proof
+ Tool cross-package adoption
+ Receipt schema/type publication
+ zero-side-effect guard
+ package tarball verification
+ Node 18/22 × Linux/Windows CI
```

Freeze 后：

- 不因 convenience 添加 runtime helper；
- 不把 Experimental domain 自动提升为 public API；
- 不静默改变 v1 parser/formatter/comparator 语义；
- breaking protocol change 必须有新版本 symbol / schema version / ADR 中适用的一种明确版本边界。

## 25. 已冻结的实施决策

以下不再留给实施阶段临场决定：

1. **一个 package + domain subpaths**，不拆 Conversation/Tool/Receipt 多个 npm 包；
2. **CommonJS-only v1**，暂不做 ESM dual publish；
3. **zero runtime dependency**；
4. **Conversation + Tool + Receipt 是 v1 scope**；
5. **Archive / Fingerprint / React Event Protocol 暂不进入 v1**；
6. **复杂 JSON Schema 不提供 bundled runtime validator**；
7. **JSON Schema 继续以 `doc/15-contracts` 为 normative source，protocol package 发布 byte-for-byte copy**；
8. **runtime/lifecycle ownership 永远留在各 producer/consumer package**；
9. **先 golden parity，再切 reference consumer，再证明 second consumer**；
10. **没有跨包真实价值的抽象不允许仅为了“统一”进入协议包**。

到这里，实施者只需要按阶段完成代码迁移和验收，不再需要重新决定包边界、首版范围、module format、validator strategy 或 schema ownership。
