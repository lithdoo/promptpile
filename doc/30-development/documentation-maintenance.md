# 文档维护

> 层级：30 · Development  
> 状态：Normative  
> 稳定程度：Stable  
> 主要定义：代码变更时需要同步哪些文档  
> 最近复核：2026-08-12

完整治理规则见 [CONVENTIONS](../CONVENTIONS.md)。

## Public contract 变更

1. 先更新 `doc/15-contracts` 的唯一 normative 定义；
2. 更新 owning package 的 machine schema/fixture/projection；
3. 更新 producer/consumer implementation；
4. 增加 regression/conformance/integration evidence；
5. 更新 `doc/20-packages` 与相关 Guide；
6. incompatible change 必须定义新版本与迁移。

Conversation/Fingerprint/Tool/Receipt 的纯公共投影还需要同步 `promptpile-protocol`。Agent Event Protocol 的 machine schema 则由 `promptpile-react` 自己拥有；不要因为 human spec 位于 Contracts 就错误转移 schema ownership。

## Architecture boundary 变更

系统职责变化先修改 `10-architecture`，再传播到 Contracts/Packages/Tests。不要因为代码复用方便，把 runtime lifecycle 塞进 protocol package，也不要让 orchestrator 穿透 owning package 私有实现。

## Package 内部实现

若 public contract 与系统 ownership 都不变，只更新对应 package 文档/README 与测试；不要把内部 helper 或文件布局复制进 Architecture/Contracts。

## Plan 生命周期

Active plan 必须明确 non-normative，不能被 canonical docs 当作现行规则。实现落地并形成 executable evidence 后：

```text
stable fact → architecture / contracts / package docs
lasting rationale → ADR
phase/checklist/temporary blocker → Git history
completed plan file → delete
```

仓库不维护 `doc/archive` 或 `doc/tracking` 作为第二套状态源。

## 文档站

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

VitePress sidebar 必须只链接 canonical current docs 与 ADR。
