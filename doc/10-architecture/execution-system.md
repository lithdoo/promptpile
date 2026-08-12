# 执行系统

> 层级：10 · Architecture  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：一次 Promptpile root completion 的生命周期与 success witness  
> 最近复核：2026-08-12

```text
resolve CLI / TOML / profile
  ↓
create invocation identity
  ↓
resolve API key + output/hook policy
  ↓
OCC preflight
  ↓
validate tools / tool_choice / sidecars / request extensions
  ↓
optional --input durable user append
  ↓
scan ordered Conversation layers
  ↓
assemble messages + missing-result policy
  ↓
exactly one streaming Chat Completions request
  ↓
require terminal witness: non-empty finish_reason OR [DONE]
  ↓
publish required output / calls / optional assistant Conversation artifact
  ↓
after-hook decision
  ↓
publish Completion Receipt last
```

## Ownership

Execution System owns canonical config/profile resolution、API key resolution、Conversation scan/assembly、tools declaration loading、missing-result policy、single Chat Completions request、stream parsing、output artifact policy、OCC、after-hook 和 Completion Receipt publication。

它不拥有 agent loop、tool execution、MCP session、fork transaction 或 context compression policy。

## Request authority

核心 request fields 只有 canonical resolved config 能定义：

```text
model
messages
stream
temperature
tools
tool_choice
```

`extra_body` 只承载 provider extension fields；包含任意 reserved core key 必须在模型调用前失败。`--disable-tool` 因此不能被 generic extension field 反向覆盖。

## Stream terminal witness

非空 SSE `data:` 必须是合法 JSON，除非 payload 精确为 `[DONE]`。HTTP 200 但流中出现 provider error、malformed non-empty payload，或 EOF 前既没有非空 `finish_reason` 也没有 `[DONE]`，都不是成功 completion。

只有 terminal witness 成立后，运行时才可以继续完成 durable assistant publication 和 completed Receipt。

## Mutation boundary

已知的 deterministic config/tool/sidecar failure 在 `--input` user append 之前完成。`--input` append 一旦成功就是独立 durable user action；其后的 network/model failure 不回滚 user artifact。

OCC 对可写 Conversation 的 append/continue publication 使用 invocation baseline、exclusive claim 与 commit-time recheck，防止基于过期观察成功提交。

## Completion Receipt theorem

```text
completed Receipt
⇒ request core semantics came from resolved Promptpile config
⇒ extra_body did not override core request fields
⇒ exactly one Chat Completions stream reached a recognized terminal state
⇒ required output lifecycle succeeded
⇒ Conversation/OCC publication semantics held
⇒ no fatal after-hook decision remained
⇒ Receipt itself was atomically published last
⇒ the current invocation succeeded
```

Receipt 的 public schema 见 [Completion Receipt v1](../15-contracts/completion-receipt-v1.schema.json)，CLI/mutation semantics 见 [CLI Contract v1](../15-contracts/cli-contract-v1.md)。
