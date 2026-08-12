# Promptpile 主包优化与 Pre-Freeze 收口计划

> 状态：已实施 / Freeze candidate（待 CI matrix 确认）
> 日期：2026-08-12  
> 审计基线：`91be8c7235fd5f95540b7b713c97dd4403ee2493`  
> 目标组件：`packages/promptpile`  
> 核心目标：保持 `promptpile` 作为**单次 Chat Completions execution primitive** 的既有定位，在不扩张 ownership 的前提下，收紧 request authority、stream terminal witness、CLI/TOML 配置契约和 package public surface，使 completed Receipt 成为可信的终态成功证明。

---

## 1. 结论摘要

当前 `promptpile` 主包整体设计方向与原定位一致，核心 Conversation / OCC / Output Artifact / After-hook / Completion Receipt 状态机没有出现架构回退。

当前主路径仍然是：

```text
resolve config
→ resolve output / hook policy
→ OCC preflight
→ optional user mutation
→ scan/build messages
→ tools + tool-choice validation
→ missing-result policy
→ sidecar validation
→ prepare sinks
→ one Chat Completions stream
→ finalize output pile
→ commit main output group
→ commit Conversation assistant artifacts
→ after-hook
→ Completion Receipt
→ process success
```

主包仍然**不负责**：

- 执行模型返回的 tool calls；
- 自动发起第二轮 completion；
- agent loop / orchestration；
- Conversation compression；
- Conversation fork；
- Archive search / MCP runtime；
- React Agent Event Protocol；
- host-specific business workflow。

因此，本计划不是一次架构重写，而是一次**边界收口**。

当前剩余问题主要集中在两类：

1. 模型请求层仍存在可以破坏已解析配置与 Receipt 事实一致性的 escape hatch；
2. streaming parser 还不能严格证明一次 completion 已经到达协议终态。

这两项属于真正的 Blocker。

---

## 2. 优化原则

本轮优化必须遵守以下原则。

### 2.1 不扩张主包 ownership

不得因为修复 request / stream contract 而引入 agent orchestration、tool execution、retry workflow 或新的 service runtime。

保持：

```text
promptpile
= one completion primitive
+ Conversation input/output boundary
+ durable output publication
+ terminal success witness
```

而不是：

```text
promptpile
≠ agent runtime
≠ workflow engine
≠ tool executor
≠ conversation lifecycle service
```

### 2.2 配置 intent 必须在模型调用前固定

所有影响核心 request 语义的字段，在 `callAIStream()` 前必须已经完成解析和校验。

模型调用阶段不得重新解释配置，也不得允许 generic extension field 覆盖核心字段。

### 2.3 不可证明的成功不得发布 completed Receipt

目标定理：

```text
current invocation publishes Completion Receipt(status=completed)
⇒ resolved Promptpile configuration uniquely determines core request semantics
⇒ exactly one valid Chat Completions request was issued
⇒ its stream reached an accepted terminal state
⇒ every required durable stage succeeded
⇒ no fatal after-hook decision remained
⇒ Receipt publication succeeded
⇒ no remaining predictable/domain required failure exists
⇒ process terminates successfully
```

该定理只覆盖正常、recoverable、domain-level failure 模型，不试图承诺 OOM、SIGKILL、机器断电等 catastrophic termination。

### 2.4 配置错误优先 fail-fast

显式用户配置不应静默降级到另一套语义。

原则：

```text
explicit intent + invalid value
→ fail before model call
```

而不是：

```text
explicit intent + typo
→ silently fall back
→ issue a different request
```

---

## 3. Blocker A：封闭 `extra_body` 对核心 request 字段的覆盖能力

### 3.1 当前问题

当前 `src/ai-client.ts` 中 request body 近似按以下顺序构造：

```ts
{
  model,
  stream,
  messages,
  temperature,
  ...(extraBody ?? {})
}
```

因此 `extra_body` 实际拥有最后写权限，可以覆盖核心字段。

风险字段至少包括：

```text
model
messages
stream
temperature
tools
tool_choice
```

这会形成以下不变量破坏。

### 3.2 Receipt 与实际请求可能分叉

例如 resolved config 中：

```text
model = expected-model
```

但 `extra_body.model` 可以把真实 request 改成另一个模型，而 after-hook / Receipt 仍基于 `config.model` 记录原模型。

于是可能出现：

```text
actual request model != Receipt.model
```

这使 Receipt 失去 success witness 的事实准确性。

### 3.3 `--disable-tool` 可能被绕过

如果主路径没有加载 tools，但 `extra_body` 自带 `tools`，当前 payload 构造不一定会删除该字段。

因此公开语义：

```text
--disable-tool
⇒ request contains no tools
```

当前还不是严格成立的不变量。

### 3.4 推荐设计

定义一组明确的 reserved request keys：

```text
model
messages
stream
temperature
tools
tool_choice
```

`extra_body` 只能携带 provider-specific extension fields，不得拥有这些字段。

在 `resolve-config` 或独立纯 validator 中完成校验：

```ts
validateExtraBodyReservedKeys(extraBody)
```

发现冲突直接失败：

```text
Error: extra_body must not override reserved request field: model
```

要求：

- CLI `--extra-body` 和 TOML/profile `extra_body` 使用同一 validator；
- validation 必须发生在 model call 前；
- validation 不应依赖 provider；
- reserved list 必须有单一 source of truth；
- tests 必须覆盖每一个 reserved key；
- `--disable-tool` 与 `extra_body.tools` 组合必须 pre-model failure；
- Receipt 的 `model` 必须与实际发送的 request model 同源。

### 3.5 不推荐方案

不推荐简单调整 spread 顺序，例如：

```ts
{
  ...extraBody,
  model,
  stream,
  messages,
  temperature
}
```

原因：

- `tools` / `tool_choice` 仍容易形成特殊覆盖规则；
- 用户以为 extra body 生效，但部分字段被静默丢弃；
- ownership 不够显式；
- future core fields 仍可能再次出现覆盖漏洞。

应采用**显式 reserved-key rejection**，而不是隐式优先级覆盖。

### 3.6 Acceptance

- [ ] `extra_body` 无法改变 `model`；
- [ ] `extra_body` 无法改变 `messages`；
- [ ] `extra_body` 无法改变 `stream`；
- [ ] `extra_body` 无法改变 `temperature`；
- [ ] `extra_body` 无法注入/覆盖 `tools`；
- [ ] `extra_body` 无法注入/覆盖 `tool_choice`；
- [ ] CLI/TOML/profile 三个来源行为一致；
- [ ] 所有冲突在模型调用前失败；
- [ ] Receipt.model 与实际 request model 可证明同源；
- [ ] `--disable-tool ⇒ request has no tools` 有 dedicated test。

---

## 4. Blocker B：建立 Chat Completions stream terminal witness

### 4.1 当前问题

当前 SSE 解析逻辑对 malformed `data:` JSON 采用 resilient ignore，并且 stream EOF 后并不要求观察到明确 terminal signal。

这意味着以下场景存在理论成功路径：

```text
provider/network sends partial valid deltas
→ trailing event malformed / stream unexpectedly EOF
→ malformed payload ignored
→ parser returns accumulated partial content
→ durable artifacts published
→ completed Receipt published
```

这与 Receipt 的终态成功语义冲突。

### 4.2 需要区分 transport resilience 与 terminal correctness

允许忽略：

- 空行；
- SSE comment/keepalive；
- 明确定义的 provider-compatible非 payload event。

不应默认忽略：

- `data:` 后存在非空但不可解析 JSON；
- payload schema 已经进入 Chat Completions event domain，但结构严重损坏；
- 未达到任何 accepted terminal condition 就自然 EOF。

### 4.3 推荐 terminal rule

定义显式 terminal witness，例如：

```text
terminal = observed non-null finish_reason
        OR observed explicit [DONE]
```

其中具体兼容规则可以根据现有 provider corpus 固化，但必须满足：

```text
EOF alone != completion success
```

建议在 parser 内部维护：

```ts
{
  sawDataEvent,
  sawDone,
  sawFinishReason,
  finishReason,
  malformedDataEvent
}
```

stream 结束时调用纯函数：

```ts
validateCompletionTerminalState(...)
```

没有合法 terminal witness 时抛出 protocol/stream error。

### 4.4 Malformed payload policy

对非空 `data:`：

```text
valid JSON ChatCompletion chunk → process
[DONE]                         → terminal marker
malformed JSON                 → failure
```

如果某些兼容 provider 确实存在非 JSON `data:` keepalive，应建立**显式、测试化、有限范围**的兼容规则，而不是 catch-all ignore。

### 4.5 与 Output Pile / Receipt 的关系

stream terminal failure 必须沿既有 required lifecycle 传播：

```text
stream protocol failure
→ output pile error/close lifecycle
→ no main output commit
→ no Conversation assistant commit
→ no after-hook success path
→ no completed Receipt
→ exit 1
```

已有 `runModelOutputLifecycle()` 的 first-primary-failure 结构应保持，不需要重写。

### 4.6 Acceptance

- [ ] valid SSE + `finish_reason` / `[DONE]` 正常成功；
- [ ] empty/keepalive event 不影响成功；
- [ ] malformed non-empty `data:` 失败；
- [ ] partial content + unexpected EOF 失败；
- [ ] non-stream JSON body 不能被误判为空成功；
- [ ] terminal failure 不提交 main output；
- [ ] terminal failure 不提交 Conversation assistant artifact；
- [ ] terminal failure 不运行 success after-hook；
- [ ] terminal failure 不发布 completed Receipt；
- [ ] primary failure 不被 output pile close failure 覆盖。

---

## 5. Pre-Freeze hardening A：CLI / package version 单源化

### 5.1 当前问题

当前 package metadata 与 Commander `.version()` 存在独立硬编码。

这会导致：

```text
npm package version != promptpile --version
```

版本是公开 CLI contract，不应有两个 truth source。

### 5.2 推荐方案

CLI version 从 package/build metadata 单源生成。

可选实现：

1. build-time 读取 `package.json` 并生成 version module；或
2. package 内部使用稳定可打包的 metadata source。

不要在 `src/cli.ts` 继续硬编码版本常量。

### 5.3 Acceptance

- [ ] `package.json.version === promptpile --version`；
- [ ] packed tarball 安装后仍一致；
- [ ] test 不依赖 workspace 根目录存在；
- [ ] release version bump 不需要修改第二处源码。

---

## 6. Pre-Freeze hardening B：TOML typed fail-fast

### 6.1 当前问题

目前部分 TOML helper 存在宽松 coercion：

```text
number / bool → string
string boolean-like → bool
unknown false-like string → false
```

例如概念上：

```toml
continue = "tru"
```

不应被解释成 `false`；应被视为配置错误。

同样：

```toml
tools_file = 123
```

不应自动成为字符串路径 `"123"`。

### 6.2 推荐 schema

对 `[promptpile]` 建立明确 field schema：

```text
string fields   → only TOML string
boolean fields  → only TOML bool
number fields   → only TOML numeric with domain validation
enum fields     → exact allowed values
array fields    → exact non-empty string array where required
object fields   → exact table/object shape
```

同时建议 unknown key fail-fast。

理由：配置文件属于长期 contract，silent typo 的风险高于“宽松接受”的收益。

### 6.3 兼容策略

若担心一次性 breaking change，可以分两步：

```text
beta N   → unknown/coerced values emit diagnostic warning
beta N+1 → strict failure
```

但对会改变 request destination / model / mutation behavior 的关键字段，优先直接严格失败。

### 6.4 Acceptance

- [ ] bool 不接受 arbitrary string；
- [ ] string 不接受 number/bool coercion；
- [ ] enum 使用统一 parser；
- [ ] unknown `[promptpile]` key 有明确 policy；
- [ ] CLI 与 TOML 对非法 domain value 的最终语义一致；
- [ ] 所有 TOML config errors 在模型调用前失败。

---

## 7. Pre-Freeze hardening C：统一显式 LLM profile selector 失败语义

### 7.1 当前兼容 seam

当前：

```text
--llm-api <missing>        → fail
[promptpile].llm_api typo  → compatibility fallback
```

这是已文档化的兼容行为，不属于实现/文档不一致。

但从最终 contract 看，显式 selector 应有同一语义。

### 7.2 目标语义

```text
any explicitly configured llm_api selector
→ selected profile must exist
→ otherwise fail before model call
```

包括：

- `--llm-api`；
- `[promptpile].llm_api`。

### 7.3 原因

避免：

```text
profile typo
→ default model/base URL/key source
→ request silently sent elsewhere
```

对于 LLM endpoint selection，这是高影响配置，不应 silent fallback。

### 7.4 Acceptance

- [ ] CLI/TOML profile name 都 case-insensitive；
- [ ] missing profile 两者都失败；
- [ ] error message 可定位 selector 来源；
- [ ] failure 发生在模型调用前；
- [ ] README 删除旧 compatibility fallback 描述。

---

## 8. Non-blocking cleanup A：package runtime dependencies

检查 `packages/promptpile/package.json` 的 runtime dependency footprint。

若发布后运行 `dist` 不需要以下包：

```text
typescript
@types/node
```

则移动到 `devDependencies`。

目标：

```text
runtime dependencies
= CLI 实际执行需要的依赖
```

减少用户安装体积和依赖暴露面。

Acceptance：

- [ ] `npm pack` 后独立目录安装成功；
- [ ] `promptpile --help` / root completion smoke 正常；
- [ ] package 不依赖 workspace-only build tooling 才能运行。

---

## 9. Non-blocking cleanup B：CLI-only package surface

当前 package 的 `main` 与 `bin` 指向同一 CLI entry，而该 entry 顶层执行 `main()`。

如果 `promptpile` 的正式 public surface 是 CLI，而不是 JS library，则应避免给消费者暗示：

```js
require('promptpile')
```

是受支持的 library API。

推荐二选一：

### 方案 A：明确 CLI-only

删除不必要的 `main` / library export surface，仅保留 `bin`。

### 方案 B：未来需要 library API

建立独立：

```text
dist/index.js      → pure module exports
dist/cli-entry.js  → CLI main
```

当前阶段更推荐方案 A，避免无意扩大 public contract。

---

## 10. `--input` mutation 边界专项复核

当前 root completion 的 `--input` 会先把 user artifact 写入 Conversation，再继续执行后续 completion。

这本身可以是合法 contract：用户输入属于独立 durable mutation，而不是 completion output transaction 的一部分。

但必须明确区分两类错误。

### 10.1 必须发生在 input mutation 前

所有能在不读取用户 stdin 的情况下确定的静态配置错误，应尽量 preflight：

- invalid config/TOML；
- invalid LLM profile；
- invalid reserved extra body；
- impossible output policy collision；
- invalid OCC condition；
- invalid explicit hook resolution policy；
- invalid output pile config。

### 10.2 可以发生在 input mutation 后

属于当前 completion 的动态/外部失败，例如：

- model API failure；
- stream failure；
- post-input concurrent OCC conflict for assistant continuation；
- after-hook failure；
- provider semantic error。

目标不是把 user input 和 assistant completion 做成一个跨网络事务，而是避免“明知配置非法还先修改 Conversation”。

Acceptance：

- [ ] 明确文档 `--input` user artifact 的 durability semantics；
- [ ] deterministic static config failures 尽量发生在 user mutation 前；
- [ ] model failure 后已写 user input 保留；
- [ ] 不引入长事务或跨模型调用 filesystem lock。

---

## 11. 文档同步要求

本轮实现完成后，需要同步以下公开说明：

- `packages/promptpile/README.md`；
- CLI `--help` 文案；
- `example.toml` / `example.sh`；
- relevant design/freeze plans；
- 如 request semantics 发生 protocol-level change，补 ADR 或明确 beta compatibility note。

特别需要明确：

```text
extra_body = provider extension fields only
```

以及：

```text
explicit llm_api selector must resolve
```

不得让 README 和 runtime 留下两套优先级解释。

---

## 12. 测试与 CI 收口

### 12.1 Dedicated unit / boundary tests

至少新增：

```text
extra-body-reserved-keys
request-core-authority
stream-terminal-state
stream-malformed-data
stream-unexpected-eof
cli-package-version
strict-toml-types
llm-profile-selector
```

### 12.2 Root E2E invariants

需要证明：

```text
invalid deterministic config
→ no model call
→ no assistant artifact
→ no completed Receipt
```

```text
partial / malformed stream
→ exit 1
→ no assistant durable output
→ no completed Receipt
```

```text
successful terminal stream
→ durable stages complete in defined order
→ Receipt last
→ exit 0
```

### 12.3 Cross-platform matrix

核心 contract 至少继续覆盖：

```text
Node 20 / Ubuntu
Node 22 / Ubuntu
Node 20 / Windows
Node 22 / Windows
```

若未来 package `engines` 提升，则矩阵应与正式支持版本同步调整，而不是测试一套、发布声明另一套。

### 12.4 Packed package smoke

依赖 `promptpile-protocol` 的 package smoke 必须遵守发布拓扑：

```text
publish protocol version
→ packed consumer install
→ smoke
```

不能把 registry 尚不存在的精确 protocol version 导致的 ETARGET 误判为 `promptpile` core runtime failure。

---

## 13. 推荐实施顺序

### Phase 1 — Request Authority

1. 增加 reserved request keys validator；
2. CLI/TOML/profile 共用；
3. request builder 不再允许 generic body 改写 core fields；
4. dedicated tests；
5. README 同步。

完成标准：

```text
resolved Config
→ uniquely determines request core fields
```

### Phase 2 — Stream Terminal Witness

1. 提取/明确 SSE terminal state；
2. malformed data fail closed；
3. unexpected EOF fail closed；
4. provider compatibility corpus；
5. Receipt negative E2E tests。

完成标准：

```text
callAIStream success
⇒ accepted terminal completion observed
```

### Phase 3 — Config Contract Hardening

1. strict TOML scalar types；
2. unknown-key policy；
3. missing profile fail-fast；
4. CLI/TOML parity tests。

完成标准：

```text
same conceptual field
→ same domain validation semantics
```

### Phase 4 — Public Surface Cleanup

1. CLI/package version single source；
2. runtime dependency cleanup；
3. CLI-only `main` surface decision；
4. npm pack independent install smoke。

### Phase 5 — Freeze Evidence

1. full package tests；
2. root E2E；
3. cross-platform CI；
4. packed package smoke；
5. docs vs implementation audit；
6. mark plan completed / Freeze。

---

## 14. Final Freeze Checklist

### Architecture

- [ ] `promptpile` 仍是 single-completion primitive；
- [ ] 无 tool execution ownership；
- [ ] 无 automatic second completion；
- [ ] 无 agent loop / compression / fork / archive ownership 回流；
- [ ] protocol package 只提供纯 schema / parser / encoding contract。

### Request

- [ ] core request fields 有唯一 authority；
- [ ] `extra_body` 不能覆盖 reserved keys；
- [ ] `--disable-tool ⇒ no request tools`；
- [ ] Receipt model 与 actual request model 同源。

### Stream

- [ ] malformed payload fail closed；
- [ ] unexpected EOF 不是 success；
- [ ] accepted terminal witness 有明确实现；
- [ ] partial stream 不发布 completed Receipt。

### Config

- [ ] CLI / TOML 字段映射一致；
- [ ] CLI / TOML domain validation 一致；
- [ ] TOML scalar 类型严格；
- [ ] explicit profile typo fail-fast；
- [ ] unknown-key policy 明确。

### Durable lifecycle

- [ ] output pile first-primary-failure 保持；
- [ ] main output group semantics 不变；
- [ ] Conversation OCC semantics 不变；
- [ ] after-hook failure policy 不变；
- [ ] Receipt 仍是最后 required durable success witness。

### Package

- [ ] `promptpile --version` 与 package version 一致；
- [ ] runtime dependencies 最小；
- [ ] CLI-only/library surface 明确；
- [ ] independent packed install smoke 通过。

### Evidence

- [ ] root tests green；
- [ ] dedicated request/stream tests green；
- [ ] Node / OS matrix green；
- [ ] docs 与实现一致；
- [ ] 不把 sibling package registry/release-order failure误判为 core functional failure。

---

## 15. Freeze 判定

只有在 Blocker A 与 Blocker B 完成后，才建议重新声明主包 runtime contract 已完整 Freeze。

最终应能够成立：

```text
completed Receipt
⇒ request obeyed resolved Promptpile core configuration
⇒ no generic extension field changed core request semantics
⇒ exactly one Chat Completions stream reached a recognized terminal state
⇒ required output lifecycle succeeded
⇒ fatal hook decision不存在
⇒ Receipt itself atomically published
⇒ current invocation terminates successfully
```

这次优化的目标不是增加功能，而是让已经存在的设计边界从“实现上大体成立”提升到“可以由代码结构、失败顺序和测试共同证明”。

---

## 16. 实施记录（2026-08-12）

Phase 1–4 已落地，并完成本地 Phase 5 证据：

- reserved request keys 使用单一 validator，CLI/TOML/profile 与 payload builder 共用；
- stream 只有观察到非空 `finish_reason` 或 `[DONE]` 才能成功；
- TOML 严格类型、unknown-key rejection，显式 profile selector 必须解析成功；
- `--input` 的确定性 tools、tool-choice 与 sidecar 校验先于 user mutation；
- CLI version 来自随包发布的 `package.json`，package surface 为 CLI-only；
- TypeScript 与 Node 类型定义已移至 `devDependencies`；
- packed smoke 先打包 sibling protocol，再在独立目录安装，避免误判 registry `ETARGET`；
- 本地 package tests 与 packed smoke 通过；
- CI 已配置 Ubuntu/Windows × Node 20/22 contract 与 packed smoke gate；主包 `engines` 与 Commander runtime dependency 均以 Node 20 为最低版本。

最终 Freeze 只在上述 CI matrix 全绿后成立；此前保持 Freeze candidate。
