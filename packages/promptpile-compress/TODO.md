# promptpile-compress TODO

> 类型：Tracking  
> 非 normative  
> 设计目标：把 `promptpile-compress` 收敛成 Conversation → Archive Protocol 的 lifecycle mutation implementation  
> 最近复核：2026-08-05

## P0 · 协议边界对齐

- [ ] 将当前 archive writer/restore 行为与 `doc/15-contracts/archive-protocol-v1.md` 建立 conformance fixtures。
- [ ] 修改 `sliding-window` summary，移除对具体 `lookup_archive` 工具存在的硬编码假设。
- [ ] 明确 invalid/incomplete archive 对 producer、restore、read-only consumer 的错误边界。
- [ ] 确认新增 manifest 字段保持 forward-compatible：consumer 必须忽略未知字段。

## P1 · Semantic summary

- [ ] 新增真正的 semantic summary strategy。
- [ ] 至少保留：goal、facts、constraints、decisions、important tool findings、completed work、unresolved work。
- [ ] summary 失败时不提交 archive，保持原 conversation 可见。
- [ ] 为 summary prompt / output 增加 deterministic fixtures 与 regression tests。

## P2 · Context budget

- [ ] 把当前字符 heuristic 与实际模型 tokenizer 的误差边界测出来。
- [ ] 决定是否启用 optional `tiktoken` 或 model-aware tokenizer adapter。
- [ ] 区分 total context、reserved output、tool schema 等预算，而不是只看 message file 字符数。

## P3 · Mutation safety

- [ ] 明确并记录 compress/restore 的 exclusive-writer 前提。
- [ ] 评估 directory lock / generation marker 是否值得实现。
- [ ] 增加 fault-injection tests，覆盖 staging 创建、逐文件移动、archive commit、summary write 各崩溃点。

## P4 · 不属于本项目的工作

以下不要继续加回 `promptpile-compress`：

- grep history search；
- `lookup_archive` / `read_archived_turn` query implementation；
- embedding / vector index；
- retrieval MCP server。

grep consumer 见 `../promptpile-compress-grep-search/TODO.md`。Vector search 如有真实需求，另建独立项目。
