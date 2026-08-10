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

- `idx` 是十进制非负安全整数排序键，数值域固定为 `0 <= idx <= 9007199254740991`（`Number.MAX_SAFE_INTEGER`）。前导零不改变数值排序键，因此 `[1]user.md` 与 `[01]user.md` 的排序 idx 都是 `1`，但仍是两个 exact path 不同的 artifact。
- 文件名数字部分匹配、但数值超出上述范围时，该文件不属于有效 Conversation artifact；scanner 按 unknown/non-protocol 文件静默忽略，不产生 rounded idx，也不降级匹配成其它 artifact kind。
- 当当前最大 idx 已为 `9007199254740991` 时，不存在合法的 next idx；append/continue mutation 必须失败且不得创建范围外 artifact。
- 文件名中的 role 原样成为 API message role。
- `.md`：UTF-8；若起始存在完整 YAML front matter，则移除后使用正文。
- `.json`：完整 UTF-8 文件内容作为字符串 content，不解析成 message object。

## 3. 同一 idx 的固定顺序

1. 普通 `[idx]{role}.md|json`，但不含 `[idx]assistant.md`；因此 `[idx]assistant.json` 仍是普通 message；多条按 role 再按路径排序；
2. `[idx]assistant.md`；
3. `[idx]assistant.calls.jsonl`；
4. `[idx]assistant.extra.json`；
5. `[idx]assistant.result.jsonl`。

全部排序字符串使用 UTF-8 编码后的 unsigned bytes 做 lexicographic ascending 比较，不依赖 OS locale、Node/ICU 默认 locale、大小写折叠或 Unicode normalization。最终路径排序键是 scanner 提供的精确 `relativePath`，不是绝对路径。

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

单个完整文件采用临时文件 + rename 的原子提交。assistant 正文及 calls/extra sidecar 仍是多个独立文件，Protocol 不承诺跨文件事务。

遵守 Conversation OCC v1 的 cooperative writer 在修改同一个 physical writable directory 前，使用保留控制文件：

```text
.promptpile.occ.claim
```

通过 exclusive create 获取短临界区所有权，并在 claim 内重新验证调用方提供的 fingerprint/next-index condition 后才执行 mutation。claim 不参与 scanner、Fingerprint、消息组装或 idx namespace；不得使用 TTL 自动偷取残留 claim。模型请求、stdin 等待、普通 `-o` 输出和 after-hook 不在 claim 临界区内。

该协议保证 cooperative writers 不会同时从同一个 expected state commit；手工编辑、旧版本或绕过 claim 的 non-cooperative writer 不在此保证范围。普通 rename 也不被声明为跨平台 atomic no-replace CAS。

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
