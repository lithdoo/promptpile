# promptpile-fork

> 类型：package  
> 状态：implemented / beta / Conversation Fork v1 frozen  
> 主要职责：单物理 Conversation selected-prefix 的 byte-exact independent snapshot  
> 代码入口：`packages/promptpile-fork/src/`  
> 最近复核：2026-08-12

`promptpile-fork` 是独立 filesystem transaction CLI。它读取一个 source physical Conversation directory，将 `idx <= throughIndex` 的 protocol-visible direct regular artifacts 复制到 same-parent private staging，经 exact verification 与 source re-observation 后，用一次 final directory rename 发布新 target。

## Public surface

```text
promptpile-fork --source <dir> --target <dir> --through-index <n>
                [--dry-run] [--format text|json]
```

Node >=18；runtime 只依赖 `promptpile-protocol`。

## Ownership

Fork owns：

- source/target canonical path validation；
- cooperative target claim；
- selected-prefix stable observation；
- private same-parent staging；
- exact staging entry-set/byte verification；
- selected source prefix re-observation；
- terminal final directory rename；
- dry-run/report/cleanup semantics。

Fork does **not** own：

- model/tool execution；
- message-body parsing/repair；
- layered Conversation materialization；
- merge/overwrite/hardlink/idx rewrite；
- archive/compression lifecycle。

## Core invariant

```text
selected prefix before copy
== exact staging snapshot
== selected prefix after copy
```

cutoff 内变化阻止 success；cutoff 外 append 不使 snapshot 失效。final target 的唯一 public commit point 是目录 rename。

正式行为见 [Conversation Fork v1](../15-contracts/conversation-fork-v1.md)。Package 中的 operation/contention/crash-boundary tests 与 dedicated workflow 是 executable evidence。
