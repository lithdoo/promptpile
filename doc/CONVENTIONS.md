# Promptpile 文档规范

> 层级：Documentation Governance  
> 状态：Normative  
> 稳定程度：Stable  
> 主要定义：文档层级、权威关系、生命周期与变更传播规则  
> 最近复核：2026-08-05

## 1. 文档层级

```text
00-overview → 10-architecture → 15-contracts → 20-packages → 25-guides / 30-development
```

`decisions/` 保存形成当前结论的过程；`tracking/` 只追踪当前推进；`archive/` 保存历史计划。它们不能覆盖现行架构或契约。

## 2. 单向依赖

1. 下层文档可以细化上层结论，不能悄悄改变上层结论。
2. 实施 package 结构不能反向定义系统架构。
3. 同一结论只能有一个主要定义位置，其他文档必须链接引用。
4. 跨 package 的不兼容变更必须修改契约并明确版本/迁移。
5. Guide 以可操作为目标，不作为 normative spec。
6. Package README 面向 package 用户；`doc/20-packages` 面向维护者与系统 ownership。

## 3. 状态与稳定度

状态：`Normative`、`Active Design`、`Reference`、`Tracking`、`Legacy`、`Archived`。  
稳定程度：`Stable`、`Evolving`、`Experimental`。

`Normative + Evolving` 表示当前实现必须遵守，但 beta 阶段仍允许通过版本化方式演进。

## 4. 变更传播

- 产品范围：Overview → Architecture → Contracts → Packages → Guides/Tests。
- 系统职责：Architecture → Contracts → Packages → Tests。
- 跨进程格式/CLI machine contract：先修改 Contracts，再改代码与回归测试。
- package 内部算法且外部行为不变：通常只更新 package 文档与测试。

## 5. 计划与历史

已完成的大型 migration plan 不继续作为当前架构主入口。当前结论进入 architecture/contracts/package docs；决策原因进 ADR；完整计划进入 archive 或明确标记 Legacy。

仓库根 `CLI_ARCHITECTURE_PLAN.md` 当前作为本轮迁移历史资料保留；现行边界以本文档站为准。

## 6. VitePress

- 文档源码固定在 `doc/`。
- `doc/index.md` 是站点首页；`doc/README.md` 是完整索引。
- GitHub Pages base 固定为 `/promptpile/`。
- sidebar 与活跃文档入口保持同步。
- 站点构建通过 `npm run docs:build`；Pages 只发布成功构建的 artifact。
