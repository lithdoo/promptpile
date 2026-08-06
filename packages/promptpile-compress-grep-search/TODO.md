# promptpile-compress-grep-search TODO

> 类型：Tracking  
> 非 normative  
> 设计目标：实现一个完全独立、只读、协议驱动、普通用户可通过 CLI 无编码使用的 Promptpile Archive grep consumer  
> 最近复核：2026-08-06

接口与产品面设计以 [`DESIGN.md`](./DESIGN.md) 为当前 active design。

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
- [x] 返回 turn 对应的 authoritative message/calls/extra/results artifacts。
- [x] 支持显式是否包含 tool results。
- [x] 对不存在、未归档或损坏 turn 返回明确错误/空结果语义。

## P3 · Grep lookup + CLI

### P3.1 Search domain

- [ ] 定义 `ArchiveSearchMatch` / `ArchiveSearchResult` / `ArchiveSearchResponse`。
- [ ] `search` 对外按 turn 聚合结果，不直接暴露 raw filesystem grep hit。
- [ ] `limit` 以 turn 为单位；结果 deterministic，默认按 `turnIdx` 从新到旧。
- [ ] v1 query 默认 literal text，不先暴露 raw ripgrep 参数或虚假 relevance score。

### P3.2 Searchable artifact enumeration

- [ ] 只搜索经过 Archive Protocol discovery/manifest 校验的 archive。
- [ ] 明确枚举 authoritative message/artifact files，不把整个 archive directory 递归交给 rg。
- [ ] 默认忽略 `compression.json`、`.summary.md`、`.promptpile-compress.*` 与其他 metadata/private/derived files。
- [ ] 支持 `includeToolResults` 控制 `assistant.result.jsonl` 搜索范围。

### P3.3 Ripgrep adapter

- [ ] 复用 `@agent-tool-lite/search` 的 `runRipgrep` / `buildGrepArgs` / `getRgPath`，不重复实现 timeout/truncation/process management。
- [ ] 将 filepath 命中映射为 `archiveIdx / turnIdx / role / fileKind / sourceFile / snippet / line`。
- [ ] 同一 turn 的多个文件/多次命中稳定聚合。
- [ ] 固定 limit、truncation、timeout 和 invalid query 的 domain error semantics。

### P3.4 Fixtures

- [ ] 中文 Markdown 查询。
- [ ] JSON / JSONL 查询。
- [ ] assistant calls / extra / tool result 查询。
- [ ] 大文件与截断行为。
- [ ] 多 archive 查询与 turn 聚合。
- [ ] private metadata / derived files 不进入结果。
- [ ] 搜索前后 archive byte-for-byte 不变。

### P3.5 `promptpile-archive` CLI

- [ ] `promptpile-archive list -d <dir>`：列出 archive / archived turns。
- [ ] `promptpile-archive search -d <dir> <query>`：按 turn 返回 grep 结果。
- [ ] `promptpile-archive read -d <dir> <turnIdx>`：读取完整 authoritative artifacts。
- [ ] `search` 支持 `--limit`、`--role`、tool-result include/exclude、`--case-sensitive`。
- [ ] `list` / `search` / `read` 支持稳定 `--json` machine output。
- [ ] human-readable CLI 与 JSON/API 使用相同 domain semantics，不重新实现查询逻辑。

P3 完成定义：普通用户无需编写 TypeScript，即可通过 CLI 完成 `search → read` 的历史检索闭环。

## P4 · MCP / Public surface

- [x] 稳定 archive discovery / read-turn library domain behavior。
- [ ] grep/CLI 真实使用验证后冻结 `searchArchive()` v1 domain surface。
- [ ] 如存在 Agent 无编码使用场景，增加 MCP adapter，优先提供 `search_archive` / `read_archived_turn`。
- [ ] MCP server 优先在启动时固定 conversation directory，不要求 tool 调用方反复传任意 filesystem path。
- [ ] MCP 只做 domain API 薄 adapter；工具名不是 Archive Protocol 本身的一部分。
- [ ] 第一版不单独维护 generic Agent Tool surface；只有出现明确 runtime 需求时再增加薄 adapter。

## Out of scope

- embedding；
- vector database；
- semantic reranker / relevance score；
- archive mutation / restore；
- compression summary generation；
- raw ripgrep compatibility surface；
- interactive TUI。

Vector search 如有真实需求，应作为另一个 Archive Protocol consumer 单独立项。
