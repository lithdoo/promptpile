# 上下文生命周期系统

> 层级：10 · Architecture  
> 状态：Active Design  
> 稳定程度：Experimental  
> 主要定义：长 conversation 的压缩、索引与恢复职责  
> 最近复核：2026-08-05

Conversation file-native 模型让历史可持久化，但历史会持续增长。Context Lifecycle System 解决“如何让长期 conversation 继续可用”，而不是改变普通 completion 的语义。

```text
conversation artifacts → scan/index/compress → compact representation → restore/retrieve
```

`promptpile-compress` 当前是 private / experimental package，已有 compress、restore、index 相关实现与测试。它可以读取 Promptpile conversation，但不要求 Promptpile core 隐式执行压缩。

如果未来压缩格式需要被多个独立实现消费，应单独提升为 versioned contract。
