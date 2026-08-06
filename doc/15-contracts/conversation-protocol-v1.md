# Conversation Protocol v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：conversation directory 的文件发现、排序与消息组装协议  
> 被以下组件实现：`promptpile`；被 React/MCP/Compress 间接依赖  
> 最近复核：2026-08-05

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
