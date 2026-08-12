# Conversation Fork v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Stable  
> Owning package：`promptpile-fork`  
> 依赖：[Conversation Protocol v1](./conversation-protocol-v1.md)  
> 最近复核：2026-08-12

Conversation Fork v1 定义一个单物理 Conversation directory 的**只读 source prefix → byte-exact independent physical snapshot** 操作。

它不是模型调用、tool execution、compression、archive clone、idx rewrite、merge、layer flatten、mutation 或 repair。

## 1. Selected prefix

给定 inclusive `throughIndex`：

```text
selected prefix
= source 根目录中
  所有 Conversation Protocol 可识别的 direct regular artifacts
  且 numeric idx <= throughIndex
```

- 只看 source 根目录；不递归。
- symlink 忽略且不 follow。
- nested entries、locks、temp、Archive 和非协议文件不属于 selected prefix。
- recognized artifact 即使其 JSON/JSONL 内容 malformed，也按原 basename 与 raw bytes 复制；Fork 不承担内容 repair。

## 2. Source / target preconditions

- source 是一个物理 Conversation directory，并在整个操作中保持只读。
- target parent 必须已存在。
- final target 在操作开始时必须不存在；v1 没有 overwrite、merge 或 `--force`。
- source 与 target 的 canonical path identity 必须不同，也不能形成 containment ambiguity；Windows identity 按平台 canonical semantics 处理。

## 3. Stable snapshot invariant

Fork 的成功 witness 是：

```text
selected source prefix before copy
== exact staging snapshot
== selected source prefix after copy
```

比较对象包括完整 selected basename set、entry kind 和 raw bytes。`throughIndex` 以内的新增、删除、改写或 entry-kind change 都使本次 fork 失去成功 witness。cutoff 以上的 append 不影响本次 fork。

## 4. Publication state machine

```text
resolve
  ↓
validate
  ↓
claim target identity
  ↓
observe selected prefix
  ↓
plan
  ↓
stage into private same-parent directory
  ↓
verify exact staging entry set + bytes
  ↓
re-observe selected source prefix
  ↓
FINAL DIRECTORY RENAME
  ↓
SUCCESS
```

claim 是 cooperative exclusivity guard；v1 fail-closed，不自动 break stale claim。staging 与 target 位于同一 parent，最终 directory rename 是**唯一 public commit point**。

final rename 之后不再执行任何会把已发布 target 重新判成 domain failure 的 required fatal work。claim release/cleanup 失败只能形成 warning/best-effort cleanup 语义。

## 5. Dry-run

`--dry-run` 可以执行 path validation、source observation、stable plan 与报告，但不得创建 claim/staging/final target 或产生其他 filesystem mutation。

## 6. Success / failure theorem

```text
success
⇒ final target 是完整、独立、可直接读取的 selected-prefix snapshot

failure before final rename
⇒ final target 不存在

source changes inside selected prefix
⇒ no success witness

source changes outside selected prefix
⇒ does not invalidate this fork
```

进程 crash 可以留下 private staging/claim entry；v1 不自动回收它们，也不会把它们当成 final target。

## 7. Conformance evidence

Owning package 的 architecture/scanner/dry-run/operation/contention/crash-boundary/package-surface tests 与专用 Conversation Fork CI 是 executable evidence。纯 filename/fingerprint 语义复用 `promptpile-protocol`；filesystem claim/staging/rename transaction 不进入 protocol package。
