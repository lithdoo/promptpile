# Promptpile Layered Conversation I/O 初步设计计划

> 状态：功能实现及专项 contract matrix 已完成；全生态 Windows lifecycle matrix 尚有失败待归因
> 日期：2026-08-07  
> 目标组件：`promptpile`、`promptpile-react`，以及依赖 Conversation Protocol 的 MCP/Compress 工具  
> 核心提案：允许重复使用 `-d/--directory` 提供有序输入目录，并以 `--output-dir` 指定唯一可写 Conversation 目录

> Phase 0 决议（2026-08-10）：规范性结论已进入 `doc/15-contracts/cli-contract-v1.md`、`conversation-protocol-v1.md` 与 `tool-artifacts-v1.md`；若本文其余草案描述与三份 contract 冲突，以 contract 为准。

## 1. 摘要

当前 Promptpile 将一个 Conversation Directory 同时作为消息输入和 `--continue` 输出位置。这种模型简单、适合单目录会话，但上层编排器若要组合只读基础上下文、共享历史和当前可写会话，通常需要复制文件或构造临时目录。

本提案增加分层 Conversation I/O：

```bash
promptpile \
  -d ./base-conversation \
  -d ./shared-context \
  --output-dir ./session-conversation \
  --continue
```

逻辑语义：

```text
读取：base-conversation
   → shared-context
   → session-conversation（output layer，自动作为最后一层输入）

写入：session-conversation only
```

这个能力应保持 Promptpile 的 CLI-first、file/artifact-first 路线。它不是通用虚拟文件系统，不引入 RPC、数据库或跨目录事务。

## 2. 目标

1. `-d/--directory` 可以重复出现，并按 CLI 中的出现顺序读取。
2. TOML 支持有序目录数组，同时兼容现有单一 `dir`。
3. `--output-dir` 指定唯一可写 Conversation Directory。
4. 输入目录按“目录层”串联，不把同名文件合并到一个全局 idx 命名空间。
5. 每个目录内部继续完整遵守 Conversation Protocol 的扫描、排序和 sidecar 配对规则。
6. `--output-dir` 自动作为最后一个输入层，使连续 completion 能读取之前的输出。
7. `--continue` 生成的 assistant 正文、calls、extra，以及与 calls 配对的 result，都留在输出目录。
8. 现有单目录命令和配置保持兼容。
9. `promptpile-react` 可以透传分层输入，并继续只依赖 Promptpile 公共 CLI。
10. 上层宿主可以只观察输出目录，确定本轮新增 artifacts。

## 3. 非目标

- 不允许同时写入多个 Conversation Directory。
- 不把不同目录中相同 idx 的文件合并为同一轮消息。
- 不允许 calls 与 result 跨目录配对。
- 不提供跨目录文件事务或多写入者协调。
- 不让 `--output-dir` 改变 `-o/--output`、output pile 的通用文件输出语义。
- 不在第一版支持 glob、递归目录、目录优先级覆盖或按文件名去重。
- 不在第一版让 `promptpile-compress` 跨多个目录执行一次联合压缩事务。
- 不引入 Dayloom 专用字段、run schema 或 RPC 协议。

## 4. CLI 草案

### 4.1 Completion

```text
-d, --directory <path>   Conversation input directory；允许重复
--output-dir <path>      唯一可写 Conversation directory
```

示例：

```bash
# 现有单目录行为，保持不变
promptpile -d ./messages -c

# 两个只读层，不写 Conversation artifact
promptpile -d ./base -d ./reference

# 两个显式输入层加一个可写输出层
promptpile -d ./base -d ./reference --output-dir ./session -c
```

CLI 数组使用重复 option，不使用逗号分隔字符串：

```bash
-d ./a -d ./b -d "./path,with,comma"
```

### 4.2 Conversation domain commands

`conversation append-user` 是 mutation 命令，第一版继续只接受一个目标目录：

```bash
promptpile conversation append-user -d ./session --quiet
```

它不需要也不应接受多个输入目录。上层宿主应把 user artifact 直接追加到当前可写 Session Conversation。

### 4.3 TOML 草案

```toml
[promptpile]
dirs = [
  "./base-conversation",
  "./shared-context"
]
output_dir = "./session-conversation"
continue = true
```

兼容现有配置：

```toml
[promptpile]
dir = "./messages"
continue = true
```

初步优先级：

```text
一个或多个 CLI --directory
> TOML dirs
> TOML dir
> 现有默认目录
```

```text
CLI --output-dir
> TOML output_dir
> 单输入目录兼容回退
```

## 5. 规范语义草案

### 5.1 目录层串联

每个输入目录独立扫描和排序，然后按目录参数顺序串联：

```text
scan(directory[0])
→ scan(directory[1])
→ ...
→ scan(outputDirectory)
```

例如：

```text
base/
  [0]system.md
  [1]user.md
  [2]assistant.md

session/
  [0]user.md
  [1]assistant.md
```

逻辑消息顺序是：

```text
base:[0]
base:[1]
base:[2]
session:[0]
session:[1]
```

不同目录中的相同 idx 不冲突，因为 idx 只在所属 physical directory 内排序和关联 artifacts。

### 5.2 输出目录自动参与读取

指定 `--output-dir` 后，输出目录自动成为最后一个输入层：

```bash
promptpile -d ./base --output-dir ./session -c
```

等价于逻辑上的：

```text
read ./base
read ./session last
write ./session
```

如果 output directory 已经出现在输入目录数组中，应去重并规范化到最后一层。去重必须基于规范化后的真实目录 identity；符号链接、大小写和平台差异的具体规则需要在 Phase 0 冻结。

### 5.3 输出 idx

`--continue` 的 next idx 只根据输出目录已有的 Conversation artifacts 计算：

```text
base:    [0..20]
session: [0..3]
next output: session/[4]assistant.*
```

不扫描所有输入目录计算全局最大 idx。这样输出目录可以独立移动、归档和恢复，且只读输入层的变化不会改变它的本地编号。

### 5.4 Sidecar 归属

Conversation sidecars 必须与其 assistant artifact 位于同一目录：

```text
session/[4]assistant.md
session/[4]assistant.calls.jsonl
session/[4]assistant.extra.json
session/[4]assistant.result.jsonl
```

禁止跨目录配对：

```text
base/[4]assistant.calls.jsonl
session/[4]assistant.result.jsonl   # 不得配对
```

`--insert-files` 和 `--append-files` 仍是非 Conversation idx sidecars：

```text
insert-files
→ 全部 conversation directory layers
→ append-files
```

### 5.5 Artifact identity

多目录模式下，仅使用 basename 或 idx 不再足以唯一标识 artifact。内部和面向 orchestrator 的引用至少需要：

```ts
interface ConversationArtifactRef {
  directoryIndex: number;
  relativePath: string;
}
```

如果 artifact 属于 output directory，可另行使用规范化 output directory identity 加 relative path。第一版不要求修改现有磁盘文件格式，但新代码和测试不得把 `[idx]assistant.md` 当作跨目录全局唯一 id。

## 6. 写入规则与兼容矩阵

| 输入 | `--continue` | `--output-dir` | 行为 |
| --- | --- | --- | --- |
| 单个 `-d` | 否 | 无 | 保持现有只读 completion 行为 |
| 单个 `-d` | 是 | 无 | 保持现有行为，读写同一目录 |
| 多个 `-d` | 否 | 无 | 允许，按序只读组合 |
| 多个 `-d` | 是 | 无 | 拒绝；要求显式指定唯一 output directory |
| 任意输入 | 任意 | 有 | output directory 自动作为最后输入层；Conversation mutation 只写该目录 |

当配置显式提供 `output_dir` 但没有 `continue` 时，Promptpile仍可读取该目录作为最后一层；本轮不会生成新的 Conversation artifact。

`-o/--output` 继续表示本次 completion 的普通主输出文件。它与 `--output-dir` 不同：

- `-o` 写普通输出及旁边的 calls/extra 文件；
- `--output-dir` 决定 Conversation Protocol 下 `--continue` artifacts 的写入位置；
- output pile 继续是流式旁路输出通道。

## 7. 路径解析和工作目录

多目录后不能继续用一个含糊的 `scanAbs` 代表全部路径语义。内部配置至少需要区分：

```ts
interface ResolvedConversationIo {
  inputDirectories: string[];
  outputDirectory?: string;
}
```

初步建议：

- CLI 中的 `-d`、`--output-dir`、`--tools-file`、`--after-hook-path` 继续相对 process cwd；
- TOML `dirs`、`dir`、`output_dir` 的相对基准应与当前 `dir` 合并规则兼容，最终在 CLI Contract 中明确；
- after-hook 的工作目录在分层模式下改为 output directory；
- after-hook 的 `PROMPTPILE_SCAN_DIRECTORY` 需要演进，不能再暗示只有一个扫描目录；
- 应新增例如 `PROMPTPILE_INPUT_DIRECTORIES_JSON` 和 `PROMPTPILE_OUTPUT_DIRECTORY` 的稳定变量；
- 旧的 `PROMPTPILE_SCAN_DIRECTORY` 在单目录兼容模式保持原值，多目录模式如何兼容需先冻结，不应静默指向任意输入层。

## 8. 对现有组件的影响

### 8.1 `promptpile`

主要改造：

- Commander 将 completion 的 `-d` 收集为有序数组；
- config/TOML 增加 `dirs` 和 `output_dir`；
- scanner 支持扫描单个目录层并返回带来源目录的结果；
- message assembly 按层串联；
- `appendAssistantTurn` 明确使用 output directory 的本地文件集合计算 next idx；
- after-hook 上下文暴露输入层和输出层；
- diagnostics 包含具体 directory layer，避免同名 artifact 报错不可定位。

### 8.2 `promptpile-react`

React 不理解 Dayloom 或其它宿主，只需要继承通用 CLI 能力：

```bash
promptpile-react \
  -d ./base \
  --output-dir ./session \
  -c \
  --max-step 8
```

阶段语义：

- Thought：读取所有目录层，Conversation artifact 写到 output directory；
- Observe：读取相同组合视图，仍将临时观察结果写到 `-o`；
- Check：继续使用空临时目录和 decision tool；
- Final：读取所有目录层，Conversation artifact 写到 output directory。

需要更新 React 的 config 类型、argv 构建、README 和 CLI boundary tests。React 仍只调用 Promptpile public CLI，不依赖私有模块。

### 8.3 `promptpile-mcp`

Tool Artifacts 的执行和检查以具体 calls 文件或一个明确目录为边界。第一版不让 `exec-calls --dir` 同时扫描多个 layer：

- 当前回合的新 calls 应位于 output directory；
- after-hook 使用 `PROMPTPILE_ASSISTANT_CALL_FILE` 指向确切 calls artifact；
- result 写回同一 output directory；
- `check` 继续对 calls/result 同目录配对。

### 8.4 `promptpile-compress`

第一版继续以单个 physical Conversation Directory 为压缩、restore 和 archive 生命周期边界。它不对多层输入做联合压缩。

推荐使用方式：

- 只读 base layers 独立管理；
- 长期活动会话集中在 output directory；
- compress 只作用于 output directory；
- archive search 工具按明确目录 identity 检索。

需要验证 output directory 中的本地 idx 和 archive protocol 不依赖其它输入层的全局 idx。

## 9. Dayloom 与其它宿主的收益

Dayloom 可以把稳定背景和当前会话分开：

```text
只读层
├─ session/system profile
├─ 共享参考 Conversation
└─ 可选历史/fixture

可写层
└─ operation/workspace/conversation
```

主要收益：

- 不复制完整输入上下文；
- output directory 可以留在持久 operation workspace；
- World、共享背景和其它输入可保持只读；
- artifact 前后快照只观察 output directory；
- staging tool calls/results 与当前 Session Conversation 保持同一生命周期；
- output directory 可以独立压缩、恢复、保留和 GC。

Dayloom 仍应把一个稳定 output directory 作为该 Session 的主要 Conversation 权威来源。多输入层适合受控上下文组合，不应被用来任意切碎一个长期会话。

## 10. 安全性和一致性

1. 所有输入和输出目录都必须规范化并验证为目录。
2. 输入目录可以是只读的；Promptpile 不应以可写性作为读取前置条件。
3. output directory 在调用模型前验证可创建、可写和可扫描。
4. 输出目录不得与普通文件或非法设备路径混淆。
5. 同一 output directory 仍不支持多个并发 writer；协调责任属于调用者。
6. 单个 artifact 保持临时文件加原子 rename；不承诺同一 assistant turn 的跨文件事务。
7. after-hook 必须只获得本轮明确的 artifact 路径，不能通过扫描所有输入层猜测目标。
8. 目录错误和 artifact 解析错误必须带 layer/path 信息，但日志不得默认输出消息正文和工具敏感参数。
9. 符号链接去重、目录嵌套和 output 位于 input 子目录等情况必须在实现前确定 fail/allow 规则。

## 11. 初步实施阶段

### Phase 0：冻结契约（已完成，2026-08-10）

- 为 CLI Contract、Conversation Protocol 和 Tool Artifacts 起草扩展条款；
- 冻结目录层串联、output 自动作为最后一层、local idx 和同目录 sidecar 规则；
- 冻结 CLI/TOML 优先级和相对路径基准；
- 冻结重复目录、符号链接和大小写不敏感平台的 identity 规则；
- 决定多目录 `--continue` 未指定 output 时是拒绝还是采用其它兼容策略；
- 明确 after-hook 环境变量迁移策略。

冻结结果：

- layer 逐目录扫描后串联；output canonical identity 去重后固定为最后 layer；idx 与 sidecar 配对严格限于 physical directory；
- CLI 目录数组整组覆盖 TOML，TOML `dirs` 与 `dir` 同时出现报错；目录类路径保留 cwd 兼容基准，TOML tools/hook 使用 conversation anchor；
- 目录 identity 使用创建/存在后的 realpath，Windows 比较不区分大小写；重复 input 保留第一次，output 移到最后；不同 identity 的嵌套目录允许；
- 多输入 root mutation（`--input` / `--continue`）缺少 output directory 时拒绝；单输入继续兼容读写同目录；
- output directory 不存在时在模型调用前递归创建并验证；
- after-hook cwd 使用 conversation anchor；新增 inputs JSON 与 output directory 环境变量，多 layer 时旧 `PROMPTPILE_SCAN_DIRECTORY` 置空并进入弃用迁移期；
- 第一版不提供关闭“output 自动成为最后输入 layer”的开关，也不新增 resolved-layer manifest 命令。

### Phase 1：Promptpile 只读多目录（已完成，2026-08-10）

- `-d` 支持重复 option；
- TOML 支持 `dirs`；
- scanner 返回来源 layer；
- message assembly 按目录顺序串联；
- 保持 `--insert-files` 和 `--append-files` 的外层位置；
- 增加重复 idx、跨目录同名和 sidecar 隔离测试；
- 暂不改变 mutation 逻辑。

### Phase 2：单一 output directory（已完成，2026-08-10）

- 增加 `--output-dir` / `output_dir`；
- output 自动成为最后输入层；
- `--continue` 只写 output directory；
- next idx 只根据 output directory 计算；
- 更新 after-hook artifact paths 和环境变量；
- 增加 crash、部分 sidecar 和只读 input layer 测试。

### Phase 3：React 继承（已完成，2026-08-10）

- `promptpile-react` CLI/config 支持重复 `-d` 和 `--output-dir`；
- Thought/Observe/Final 正确透传目录层；
- Check 保持隔离临时目录；
- 验证多 step calls/results 始终落在 output directory；
- 增加 fake Promptpile argv contract 和真实 Promptpile parser 集成测试。

### Phase 4：生态验证和文档（功能与专项验证已完成；全生态 Windows matrix 待归因，2026-08-10）

- 验证 `promptpile-mcp exec-calls/check` 对 output artifacts 的兼容性；
- 验证 `promptpile-compress` 只处理 output directory 的生命周期；
- 验证 grep-search 能按明确 Conversation Directory 检索 archive；
- 更新生态总览、CLI Contract、Conversation Protocol、Tool Artifacts、README 和示例；
- 增加 Windows/POSIX 路径、符号链接和只读权限测试。

Layered 专项 workflow 已在 Ubuntu/Windows Node 22 覆盖 Promptpile、React、MCP 和 Compress contracts。全生态 `Context lifecycle quality` matrix 同一 HEAD 仍有 Windows 失败：Node 18 的 archive consumer 失败在上一提交已存在，Node 22 的 producer/restore 测试阶段失败尚未稳定复现或完成归因。因此这里不把全生态 matrix 记为 Phase 4 已完整验收，也不把该失败归因于 Layered runtime。

## 12. 测试计划

至少覆盖：

1. 单 `-d` 无 output 的完整向后兼容。
2. 多 `-d` 按参数顺序组装，不按跨目录 idx 交错。
3. 不同层相同 idx、role 和 basename 均不冲突。
4. 同目录 calls/result 正确配对，跨目录绝不配对。
5. output directory 自动追加为最后输入层并正确去重。
6. next idx 只使用 output directory 本地最大 idx。
7. 多输入加 `--continue` 但缺少 output 时按冻结规则失败。
8. input layer 为只读时 completion 和 output 写入仍成功。
9. output directory 不可写时在模型调用前失败。
10. `insert-files → layered conversation → append-files` 顺序稳定。
11. after-hook 获得准确的 output assistant/calls/extra 路径。
12. `promptpile-react` 的 Thought 和 Final 写入 output，Observe/Check 不污染 Conversation。
13. output directory 单独执行 compress/restore 后字节与 artifact 完整性成立。
14. CLI/TOML 优先级、相对路径和重复目录规则跨平台一致。

## 13. 验收标准

1. 现有单目录测试不修改语义即可通过。
2. `-d a -d b` 的模型消息严格等于 `scan(a)` 后接 `scan(b)`。
3. 指定 output 后，所有 `--continue` Conversation artifacts 只写 output directory。
4. output directory 中的 next idx 不受只读输入层 idx 影响。
5. 任何 calls/result 配对都不跨 physical directory。
6. 上层宿主只扫描 output directory即可确定本轮新增 artifacts。
7. Promptpile React 不需要任何 Dayloom 专用代码即可使用该能力。
8. Promptpile MCP 和 Compress 不需要穿透 Promptpile 私有实现。
9. CLI Contract 与 Conversation Protocol 对目录层、写入目标和 artifact identity 的描述无歧义。
10. Windows 和 POSIX 上的路径规范化、目录顺序和写入规则具有 contract tests。

## 14. Phase 0 已决事项

1. realpath 相同的 input/output 去重，不额外警告；output 移到最后。
2. Windows 使用 realpath 加不区分大小写比较；POSIX 保持大小写敏感。
3. output 不存在时在模型调用前递归创建，权限遵循 umask / 平台默认 ACL，并立即做目录与可写性验证。
4. TOML `dirs` 与 `dir` 同时出现视为配置错误。
5. 多 layer 时旧 `PROMPTPILE_SCAN_DIRECTORY` 置空并 deprecated；新增 JSON 数组变量作为稳定替代，旧变量至少保留一个 minor release。
6. after-hook cwd 使用 conversation anchor：显式/兼容 output 优先，否则最后一个有效 input。
7. CLI tools/hook 路径相对 cwd；TOML tools/hook 相对 conversation anchor，以保持单目录兼容并为 layered mode 提供确定基准；不恢复 tools 默认发现。
8. 第一版不新增 resolved-layer/artifact manifest 命令；以 diagnostics 和 contract tests 验证。
9. output 已作为 input 出现时按 canonical identity 删除旧位置并只在最后保留。
10. 第一版不允许关闭 output 自动作为最后输入 layer。

## 15. 预期修改范围

预计涉及但不限于：

```text
packages/promptpile/src/cli.ts
packages/promptpile/src/types.ts
packages/promptpile/src/config.ts
packages/promptpile/src/resolve-config.ts
packages/promptpile/src/toml-config.ts
packages/promptpile/src/file-handler.ts
packages/promptpile/src/index.ts
packages/promptpile/src/after-hook.ts

packages/promptpile-react/src/cli.ts
packages/promptpile-react/src/types.ts
packages/promptpile-react/src/resolve-react-config.ts
packages/promptpile-react/src/build-phase-argv.ts

doc/15-contracts/cli-contract-v1.md
doc/15-contracts/conversation-protocol-v1.md
doc/15-contracts/tool-artifacts-v1.md
```

具体文件以 Phase 0 的 contract 和代码勘察结果为准，不应先修改实现再反推协议。
