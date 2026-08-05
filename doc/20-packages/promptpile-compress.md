# promptpile-compress

> 类型：package  
> 状态：experimental / private  
> 主要职责：conversation 压缩、索引、restore/retrieval 方向  
> 最近复核：2026-08-05

`promptpile-compress` 独立处理 Promptpile conversation directory，当前 package 标记 `private: true`。仓库包含 DESIGN、compress/restore implementation plans，以及 scanner/index/restore/compress 测试。

它属于 [Context Lifecycle System](../10-architecture/context-lifecycle-system.md)，不应成为普通 `promptpile` completion 的隐式步骤。

当前文档站不把 compress 内部格式声明为跨实现稳定协议；如果未来需要外部 consumer，应新增 versioned contract 后再承诺兼容。

[查看 DESIGN](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress/DESIGN.md)
