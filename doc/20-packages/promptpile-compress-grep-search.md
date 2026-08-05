# promptpile-compress-grep-search

> 类型：project scaffold  
> 状态：scaffold / private  
> 主要职责：基于 Archive Protocol 的只读 grep history retrieval  
> 最近复核：2026-08-05

`packages/promptpile-compress-grep-search/` 当前只是空项目 scaffold：只包含 README 与 TODO，**尚未添加 `package.json`，因此当前不是 npm workspace package，也不会进入 Pages active-package build gate**。

这样处理是有意的：根 workspace 使用 `packages/*`，在没有同步 `package-lock.json` 与实现代码之前加入 package metadata 会让 `npm ci` 失去可重复性。

## 目标边界

```text
Archive Protocol
      │ read-only
      ▼
promptpile-compress-grep-search
      │
      └── generic grep mechanism → @agent-tool-lite/search
```

该项目未来必须：

- 只依据 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md) 发现和解析 archive；
- 不 import `promptpile-compress` 私有源码或构建产物；
- 不修改 archive authoritative state；
- 优先复用 `@agent-tool-lite/search` 的 ripgrep mechanism，而不是重写 grep runner；
- 输出 turn/role/snippet 等 Promptpile archive 领域结果。

Vector / embedding search 不属于本项目；如果 grep retrieval 的实际效果不足，再新增独立 vector consumer。

[查看项目 TODO](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress-grep-search/TODO.md)
