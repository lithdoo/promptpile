# promptpile-protocol

> 类型：package  
> 状态：implemented / beta / v1 surface stable  
> 主要职责：稳定 public protocol 的纯可执行投影  
> 代码入口：`packages/promptpile-protocol/src/`  
> 当前版本：`0.1.0-beta.1`  
> 最近复核：2026-08-12

## 定义

```text
promptpile-protocol
= pure TS types + parser/formatter/comparator + machine-readable schemas
= stable public protocol executable projection
≠ runtime/framework/core package
```

当前 public subpaths：

```text
promptpile-protocol/conversation
promptpile-protocol/fingerprint
promptpile-protocol/tool
promptpile-protocol/receipt
promptpile-protocol/schemas/completion-receipt-v1.json
```

Package 为 CommonJS，Node >=18，无 runtime dependencies；import 不执行 filesystem/process lifecycle side effect。

## Authority chain

```text
doc/15-contracts
  ↓ normative semantics
repo conformance fixtures / schemas
  ↓
promptpile-protocol
  ↓
producer / consumer packages
```

Protocol package 不能反向定义 contract。它只投影已经有 normative contract、conformance evidence 和真实跨 package reuse 的纯语义。

## Admission rule

一个能力只有同时满足以下条件才应进入 protocol：

```text
stable public protocol
+ pure data/function
+ no runtime/lifecycle effects
+ normative contract
+ conformance evidence
+ real cross-package reuse
```

因此 filesystem discovery/read/write、scanner traversal、realpath/cwd/env、allocator、OCC/lock/CAS、CLI/config、HTTP/SSE、hooks、Receipt builder/commit、MCP execution、compression/restore、React FSM 等永久属于 owning runtime package，而不是 protocol。

## Domain ownership

- Conversation：filename grammar、idx parser、artifact classifier/formatter/comparator。
- Fingerprint：canonical Conversation observation 的纯 digest semantics，供 execution/fork 等 consumer 共享。
- Tool：ToolCall/ToolResultLine v1 types 与 parser。
- Receipt：Completion Receipt public types/schema；Receipt builder、ledger、atomic publication 仍由 `promptpile` 拥有。

正式契约见 [Contracts](../15-contracts/README.md)。
