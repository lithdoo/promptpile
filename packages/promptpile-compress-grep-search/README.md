# promptpile-compress-grep-search

> 状态：Archive reader foundation / private
> 类型：Archive Protocol read-only consumer  
> 最近复核：2026-08-06

这是一个独立、只读、协议驱动的 Archive Protocol consumer。当前已经成为 npm
workspace package，实现 archive discovery、v1 manifest 校验和 deterministic
`readArchivedTurn()`；grep query 与 Agent tool surface 仍在后续 TODO 中。

核心原则：

- production code 只依据 Archive Protocol，不依赖 `promptpile-compress` 源码、
  `dist` 或私有类型；
- reader 不修改 archive、manifest、summary 或 archived artifacts；
- integration test 通过 producer 的公开 package API 创建 archive，再由本包读取，
  并验证读取前后 byte-for-byte 不变；
- grep mechanism 后续优先复用 `@agent-tool-lite/search`；vector 能力保持独立。

```ts
import {
  discoverArchives,
  readArchivedTurn,
} from 'promptpile-compress-grep-search';

const archives = await discoverArchives(directory);
const turn = await readArchivedTurn(directory, 12, {
  includeToolResults: true,
});
```

当前工作见 [`TODO.md`](./TODO.md)。
