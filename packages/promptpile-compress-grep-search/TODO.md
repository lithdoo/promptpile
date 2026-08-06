# promptpile-compress-grep-search TODO

> 类型：Tracking  
> 非 normative  
> 设计目标：实现一个完全独立、只读、协议驱动的 Promptpile Archive grep consumer  
> 最近复核：2026-08-06

## P0 · Bootstrap

- [x] 创建 `package.json` / `tsconfig.json` / `src/`。
- [x] 更新 root `package-lock.json`，确保 `npm ci` 可重复。
- [x] 将新 workspace 加入 root build/test、Pages 与 filesystem matrix gate。

## P1 · Archive Protocol reader

- [x] 只依据 `doc/15-contracts/archive-protocol-v1.md` 实现 archive discovery。
- [x] 校验 `compression.json.version` 与 `archivedTurnIndices` 最小 contract。
- [x] 解析 archived Conversation Protocol files，建立 `turnIdx / role / fileKind` 映射。
- [x] 明确拒绝 invalid/ambiguous archive；不执行 recovery，不写文件。
- [x] 增加 architecture guard：production code 不得 import `promptpile-compress` implementation。

## P2 · Read turn

- [x] 实现 `readArchivedTurn(idx, options)` 的 deterministic reader。
- [x] 正确组合 assistant message、calls、extra、results。
- [x] 支持显式是否包含 tool results。
- [x] 对不存在、未归档或损坏 turn 返回明确错误/空结果语义。

## P3 · Grep lookup

- [ ] 定义 query result：至少 `turnIdx`、`role`、`snippet`、source file。
- [ ] 优先复用 `@agent-tool-lite/search` 的 ripgrep runner，不重复实现 timeout/truncation/process management。
- [ ] 默认只搜索 Archive Protocol message/artifact files，忽略 metadata/private files。
- [ ] 将 filepath 命中映射回 Promptpile turn 领域结果。
- [ ] 为中文、JSONL tool result、大文件和多 archive fixture 增加测试。

## P4 · Public surface

- [x] 稳定 archive discovery / read-turn library domain behavior。
- [ ] 在 grep lookup 完成后再决定 CLI 命令名与参数。
- [ ] 如需要 Agent tool surface，再定义 `lookup_archive` / `read_archived_turn` adapter；工具名不是 Archive Protocol 本身的一部分。
- [ ] MCP exposure 只有在真实 consumer 场景需要时再添加。

## Out of scope

- embedding；
- vector database；
- semantic reranker；
- archive mutation / restore；
- compression summary generation。

Vector search 如有真实需求，应作为另一个 Archive Protocol consumer 单独立项。
