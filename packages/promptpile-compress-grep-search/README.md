# promptpile-compress-grep-search

> 状态：Scaffold  
> 类型：Archive Protocol read-only consumer  
> 最近复核：2026-08-05

这是一个**空项目 scaffold**，目标是基于 Promptpile Archive Protocol 实现历史 conversation 的 grep 检索。

当前目录故意只有文档，没有 `package.json`、源码或构建脚本，因此尚未成为 npm workspace package。开始实现时再同一变更中加入 package metadata、root lockfile 与 CI gate。

## 设计目标

```text
promptpile-compress
      │ writes
      ▼
Archive Protocol
      │ reads only
      ▼
promptpile-compress-grep-search
      │
      └── generic grep mechanism → @agent-tool-lite/search
```

核心原则：

- **协议驱动**：只依据 `doc/15-contracts/archive-protocol-v1.md`，不 import compress 私有实现。
- **只读**：不修改 archive、manifest、summary 或 archived message files。
- **领域与 mechanism 分离**：Promptpile turn/role/archive mapping 在本项目；ripgrep execution 优先复用 `@agent-tool-lite/search`。
- **索引可再生**：第一版不创建持久索引；未来任何 cache/index 也不能成为 archive authoritative state。
- **Vector 独立**：如 keyword grep 不足，再新建独立 vector consumer，不把 embedding/vector stack 塞入本项目。

当前工作见 [`TODO.md`](./TODO.md)。
