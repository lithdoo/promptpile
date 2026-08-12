# Promptpile 文档规范

> 层级：Documentation Governance  
> 状态：Normative  
> 稳定程度：Stable  
> 主要定义：文档层级、权威关系、生命周期与变更传播规则  
> 最近复核：2026-08-12

## 1. 文档层级

```text
00-overview → 10-architecture → 15-contracts → 20-packages → 25-guides / 30-development
```

- `00-overview/` 定义产品范围与当前成熟度。
- `10-architecture/` 定义系统职责、ownership、状态机和允许的依赖方向。
- `15-contracts/` 定义跨进程、跨 package 的 normative machine/public contract。
- `20-packages/` 说明各 package 如何承担既定职责，不反向定义架构。
- `25-guides/` 面向使用者，不作为 normative spec。
- `30-development/` 定义测试、发布和维护方法。
- `decisions/` 只保存仍有解释价值的架构决策及其理由。

## 2. 唯一真相源

```text
doc/                         = current truth
decisions/                   = lasting rationale
tests / schemas / fixtures   = executable evidence
Git history                  = migration / transformation history
```

同一结论只能有一个主要定义位置。其他文档必须链接到主要定义，不复制一份可独立演化的规则。

已完成的 implementation / migration / optimization / freeze plan **不保留在当前文档树或 archive 中**。其中仍有效的事实必须先进入 architecture、contracts、package docs 或 ADR；实施阶段、临时 blocker、checklist 和被淘汰方案由 Git history 保存。

尚未实施的计划可以作为明确标记为 non-normative 的 active design/backlog 存在，但不得被当前 architecture/contracts 引用为现行事实。实现完成后应迁移事实并删除计划文件。

## 3. 单向依赖

1. 下层文档可以细化上层结论，不能悄悄改变上层结论。
2. package 内部实现不能反向定义系统架构。
3. 跨 package 的不兼容变更必须先修改正式契约，并明确版本与迁移。
4. package README 面向 package 用户；`doc/20-packages` 面向维护者与系统 ownership。
5. public schema 可以由 owning package 发布；进入 `doc/15-contracts` 不等于把 schema ownership 转移给 `promptpile-protocol`。

## 4. 状态与稳定度

文档状态使用：`Normative`、`Reference`、`Active Design`。  
稳定程度使用：`Stable`、`Evolving`、`Experimental`。

`Normative + Evolving` 表示当前实现必须遵守，但 beta 阶段仍允许通过版本化方式演进。`Active Design` 只能描述尚未冻结的当前设计面，不能用于已经由实现与 conformance evidence 固化的 v1 规则。

## 5. 变更传播

- 产品范围：Overview → Architecture → Contracts → Packages → Guides/Tests。
- 系统职责：Architecture → Contracts → Packages → Tests。
- 跨进程格式/CLI machine contract：Contracts → schema/fixtures → producer/consumer → integration tests。
- package 内部算法且外部行为不变：通常只更新 package 文档与测试。

每个 normative statement 应能找到实现与 executable witness；测试名称不是契约本身，契约也不能声称 CI 已通过而没有对应运行证据。

## 6. VitePress

- 文档源码固定在 `doc/`。
- `doc/index.md` 是站点首页；`doc/README.md` 是完整索引。
- GitHub Pages base 固定为 `/promptpile/`。
- sidebar 与 canonical docs 保持同步。
- 站点构建通过 `npm run docs:build`；Pages 只发布成功构建的 artifact。
