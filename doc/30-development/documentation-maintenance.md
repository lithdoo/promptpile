# 文档维护

> 层级：30 · Development  
> 状态：Normative  
> 稳定程度：Stable  
> 主要定义：代码变更时需要同步哪些文档  
> 最近复核：2026-08-05

完整治理规则见 [CONVENTIONS](../CONVENTIONS.md)。

## 修改公开 CLI

1. 更新 [CLI Contract v1](../15-contracts/cli-contract-v1.md)；
2. 更新对应 package 文档与相关 Guide；
3. 增加/修改 CLI regression tests；
4. 如为 breaking change，写迁移说明。

## 修改 conversation 文件语义

1. 更新 [Conversation Protocol v1](../15-contracts/conversation-protocol-v1.md)；
2. 检查 MCP/React/Compress consumer；
3. 更新 contract/integration tests。

## 修改 archive 文件语义

1. 先更新 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md)；
2. 检查 `promptpile-compress` producer/restore；
3. 检查所有独立 archive consumer，包括 grep/vector search；
4. 更新 cross-package conformance fixtures；
5. breaking change 必须定义版本与迁移策略。

## 修改 package 内部实现

如果 public contract 不变，只更新对应 `20-packages` 文档、package README/设计文档和测试；不要为了描述内部代码把细节复制进 architecture/contracts。

## 文档站

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

VitePress 版本在 npm script 中固定，避免 Pages 与本地构建使用不同 generator 版本。
