# promptpile-compress-grep-search TODO

> 类型：Tracking  
> 非 normative  
> 设计目标：实现一个完全独立、只读、协议驱动、普通用户可通过 CLI 无编码使用的 Promptpile Archive literal-search consumer
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
- [x] 对不存在、未归档或损坏 turn 返回稳定 domain error。

## P3 · Literal archive search + CLI

### P3.0 Contract closure

- [x] 将 domain failure 改为稳定 error code，不要求调用方解析自然语言。
- [x] 固定 read 默认包含、search 默认排除 tool results，并提供拒绝 CLI 冲突参数的共享 resolver。
- [x] 修正 `readArchivedTurn()` artifact 顺序，使其遵循 Conversation Protocol。
- [x] 在 machine contract 中固定 `truncated` 为成功状态、timeout 为 `SEARCH_TIMEOUT`；具体 search response 在 P3.1 实现。
- [x] 冻结 CLI JSON envelope 与 exit code mapping，并增加 contract tests。

### P3.1 Search domain / artifact enumeration

- [x] 定义 search result/options/response、backend 与 safety-limit 类型，不提供 score。
- [x] 解析并校验 literal query、turn `limit`、roles、tool-result 和 case-sensitive options。
- [x] 只从 Archive Protocol discovery/manifest 校验通过的 archive 枚举 `SearchableArtifact[]`。
- [x] 忽略 manifest 未声明 turn、`compression.json`、`.summary.md`、`.promptpile-compress.*` 与其他 metadata/private/derived files。
- [x] 支持大小写敏感 role 与 tool-result 过滤，并按 turn/archive/Conversation Protocol artifact 顺序确定性排序。
- [x] 对无 archive 或 manifest 声明 turn 缺少 authoritative artifact 的状态 fail closed。

### P3.2 Node.js streaming scanner

- [x] 使用 `fs.createReadStream()` 与有界 line splitter 实现逐块 literal search，不依赖 `@agent-tool-lite/search` 或外部二进制。
- [x] scanner 只接收已验证并明确枚举的 `SearchableArtifact[]`，不自行递归发现文件。
- [x] 支持取消、timeout、有限并发、match/snippet/line 安全上限。
- [x] 将行命中直接映射为 `archiveIdx / turnIdx / role / fileKind / sourceFile / snippet / line`。
- [x] 同一 turn 的多个文件/多次命中稳定聚合。
- [x] `truncated` 只表示成功结果受 turn limit 或安全上限截断；timeout 返回 `SEARCH_TIMEOUT`。
- [x] 覆盖中文 Markdown、JSON/JSONL、tool-heavy、跨 chunk/长行、大文件、多 archive 与只读 byte snapshot tests。

### P3.3 `promptpile-archive` CLI

- [x] `promptpile-archive list -d <dir>`：列出 archive / archived turns。
- [x] `promptpile-archive search -d <dir> <query>`：按 turn 返回 literal search 结果。
- [x] `promptpile-archive read -d <dir> <turnIdx>`：读取完整 authoritative artifacts。
- [x] `search` 支持 `--limit`、可重复 `--role`、tool-result include/exclude、`--case-sensitive`。
- [x] `list` / `search` / `read` 支持稳定 `--json` machine envelope、stderr 与 exit code。
- [x] human-readable CLI 与 JSON/API 使用相同 domain semantics，不重新实现查询逻辑。
- [x] 增加 package `bin` entry、Node-compatible shebang 与构建产物 CLI smoke test。

### P3.4 Performance / release gate

- [ ] 建立小型、1,000 turns 与大 JSONL archive benchmark。
- [ ] 记录首次查询延迟、吞吐、峰值内存与提前终止行为。
- [ ] Node scanner 未达到明确性能目标前，不引入第二 backend；只有基准证明需要时才评估可选高吞吐 backend。
- [ ] 验证 Node 18/22 × Windows/Linux，无外部搜索二进制依赖。

P3 完成定义：普通用户无需编写 TypeScript，即可通过 CLI 完成 `search → read` 的历史检索闭环。

## P4 · MCP / Public surface

- [x] 稳定 archive discovery / read-turn library domain behavior。
- [ ] literal search/CLI 真实使用验证后冻结 `searchArchive()` v1 domain surface。
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
- raw filesystem search / ripgrep compatibility surface；
- interactive TUI。

Vector search 如有真实需求，应作为另一个 Archive Protocol consumer 单独立项。
