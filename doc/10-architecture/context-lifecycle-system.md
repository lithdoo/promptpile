# 上下文生命周期系统

> 层级：10 · Architecture  
> 状态：Active Design  
> 稳定程度：Experimental  
> 主要定义：长 conversation 的压缩、归档、恢复与检索职责边界  
> 最近复核：2026-08-05

Conversation file-native 模型让历史可持久化，但历史会持续增长。Context Lifecycle System 解决“如何让长期 conversation 继续可用”，而不是改变普通 completion 的语义。

```text
Conversation Protocol
      │
      ▼
promptpile-compress
  compress / restore / recovery
      │
      ▼
Archive Protocol
      │
      ├── promptpile-compress-grep-search   read-only grep consumer
      └── future vector search              optional independent consumer
```

## 职责拆分

### Lifecycle mutation

`promptpile-compress` 负责：

- threshold / keep window 决策；
- summary strategy；
- archive staging / commit；
- restore；
- crash recovery；
- Archive Protocol producer 语义。

它**不负责** grep、embedding、向量索引、query ranking 或 MCP retrieval server。

### Archive retrieval

历史检索是 Archive Protocol 的 consumer，而不是 compress 的内部模块。当前新增 `promptpile-compress-grep-search` 空 scaffold，目标是实现零外部索引的只读 grep 检索。未来如确有需要，再新增独立 vector consumer，而不是把 vector stack 塞回 compress。

## 为什么拆开

压缩/恢复是 destructive lifecycle mutation；搜索是 read-only query。两者在失败模型、依赖、扩展速度和产品 surface 上差异很大。用 Archive Protocol 连接它们，可以让：

- compress format 被第二个独立实现真正验证；
- grep consumer 不依赖 compress 私有代码；
- vector/remote search 后端按需出现；
- archive 保持 authoritative state，搜索索引保持 disposable derived state。

详细互操作规则见 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md)。
