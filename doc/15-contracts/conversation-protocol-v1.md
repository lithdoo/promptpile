# Conversation Protocol v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：conversation directory 的文件发现、排序与消息组装协议  
> 被以下组件实现：`promptpile`；被 React/MCP/Compress 间接依赖  
> 最近复核：2026-08-10

## 0. Conversation layers

一次 completion 可以读取一个有序 Conversation Directory 列表。每个物理目录是独立 layer：实现先按本协议完整扫描、排序并组装一个 layer，再按有效目录顺序串联各 layer 的 messages。不得先把全部文件放入共享 idx 或 basename 命名空间再排序。

```text
scan(layer[0]) -> scan(layer[1]) -> ... -> scan(layer[n])
```

因此不同目录中的相同 idx、role 或 basename 不冲突。`[0]system.md` 在两个 layer 中表示两条按 layer 顺序出现的独立消息。

指定 output directory 时，它按 CLI Contract v1 的 canonical identity 去重后固定为最后一个输入 layer，并且是 root completion 唯一可写的 Conversation Directory。`--continue` 的 next idx 只根据该 output directory 本地扫描结果计算，不受其他 layer 的 idx 影响。未显式指定 output directory 的单层兼容模式仍在该层本地计算和写入。

`--insert-files` 的消息位于全部 Conversation layers 之前，`--append-files` 的消息位于全部 layers 之后；两者都不属于任何 layer，也不参与 idx 或目录 identity。

## 1. 扫描范围

Conversation scanner 只读取配置目录的**直接子文件**，不递归进入子目录。

普通消息文件：

```text
^\[(\d+)\](.+?)\.(md|json)$
```

专用 assistant artifacts：

```text
[idx]assistant.calls.jsonl
[idx]assistant.extra.json
[idx]assistant.result.jsonl
```

上述匹配大小写敏感：扩展名和专用 artifact 的 `assistant`、`calls`、`extra`、`result` 必须使用协议中给出的精确小写拼写。

## 2. 普通消息

- `idx` 是十进制非负整数排序键。
- 文件名中的 role 原样成为 API message role。
- `.md`：UTF-8；若起始存在完整 YAML front matter，则移除后使用正文。
- `.json`：完整 UTF-8 文件内容作为字符串 content，不解析成 message object。

## 3. 同一 idx 的固定顺序

1. 普通 `[idx]{role}.md|json`，但不含 `assistant`；多条按 role 再按路径排序；
2. `[idx]assistant.md`；
3. `[idx]assistant.calls.jsonl`；
4. `[idx]assistant.extra.json`；
5. `[idx]assistant.result.jsonl`。

calls/extra 与 assistant 内容合并进 assistant message；result 中每条结果形成 tool message。

该排序、合并和 calls/result 配对只在同一个 physical directory 内进行。scanner 不得用另一个 layer 的同 idx assistant、calls、extra 或 result 补全当前 layer。

## 4. Sidecar messages

`--insert-files` / `--append-files` 接收用 `|` 分隔的路径。basename 必须为 `{name}.{role}.md`，role 仅允许 `system | user | assistant`。

- 相对路径相对当前工作目录；
- 空白正文跳过；
- insert-files 在 scanned conversation 之前；
- append-files 在 scanned conversation 之后；
- sidecar 不参与 conversation idx。

## 5. Append user

```bash
promptpile conversation append-user -d <directory>
```

正文从 stdin 读取；只完成 conversation mutation，不要求 API key、不加载 tools、不调用 LLM。

## 6. Atomicity 与并发

单个完整文件采用临时文件 + rename 的原子提交。Protocol **不提供跨文件事务，也不保证多写入者 next-index 协调**。

## 7. Artifact identity 与 diagnostics

多 layer completion 中，artifact 的最小稳定引用是：

```ts
interface ConversationArtifactRef {
  directoryIndex: number;
  relativePath: string;
}
```

`directoryIndex` 指有效目录列表中的位置，`relativePath` 是相对该 canonical directory 的直接子文件路径。实现内部可以同时保存 canonical directory identity，但 basename、idx 或 `relativePath` 单独都不是跨 layer 唯一 id。output artifacts 也可用 canonical output directory identity 加 relative path 引用。

解析错误、缺失 result diagnostics 和冲突报告必须至少包含 directory layer 或 canonical path，使两个同名 artifact 可区分；默认 diagnostic 不得打印消息正文或工具 arguments。

## 8. 目录边界

输入目录必须存在；output directory 的创建和 canonical identity 规则由 CLI Contract v1 定义。目录之间允许父子嵌套，但 scanner 只读取各 layer 的直接子文件，因此父 layer 不会发现子 layer 的 artifact。符号链接目录按其 realpath identity 去重；文件级符号链接是否作为普通直接子文件读取继续服从 scanner 的既有文件类型规则，不改变 layer identity。

## 9. 下游单目录边界

Layer list 是 completion assembly 的输入，不自动成为所有生态命令的参数：

- tool executor 接收 output directory 中的精确 calls 文件，或只扫描一个明确目录；
- compress/restore 只管理一个 physical Conversation Directory 的 archive 生命周期；
- archive retrieval 只发现和读取一个明确 Conversation Directory 下的 archive。

因此调用方应把 output directory 作为下游 session 边界。任何下游 consumer 若需要另一个 layer，必须显式、独立地选择它，不能借 basename、idx 或当前工作目录推断跨 layer 关系。
