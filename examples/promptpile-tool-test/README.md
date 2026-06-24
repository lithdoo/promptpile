## promptpile-tool-test example

`promptpile-chat-loop` 风格的多轮对话循环 + 工具执行：从 `@agent-tool-lite/*` 自动收集工具并生成 `messages/.tools.toml`；`run-example.bat` 在 `--input --continue` 循环里跑 `promptpile`，模型若返回 `tool_calls`，after-hook 立即调用 `scripts/generate-tool-results.ts` 生成对应的 `[N]assistant.result.jsonl`。**不再使用 `outputs/` 目录**，所有产物都落在 `messages/`。

## Prerequisites

- Set user environment variable: `DEEPSEEK_API_KEY`
- Run from this folder with `run-example.bat`
- Ensure Bun is installed

模型、API 地址、消息目录和工具文件由 [`promptpile.toml`](promptpile.toml) 显式配置；`.env` 中的 `AI_*` / `SEARXNG_*` 仅供 agent-lite web 工具读取，不再作为 promptpile 自身的配置层。

## 生成 tools.toml

1. 在仓库 `examples/` 目录安装依赖（使用共享的 `examples/package.json`）：

```bash
cd examples
bun install
```

2. 生成 `promptpile-tool-test/messages/.tools.toml`：

```bash
cd examples
bun promptpile-tool-test/scripts/generate-tools-toml.ts
```

该脚本会：

- 聚合 `@agent-tool-lite/file`、`@agent-tool-lite/search`、`@agent-tool-lite/shell`、`@agent-tool-lite/web` 的工具定义。
- 写入 `messages/.tools.toml`（`function.parameters` 会写成 JSON 字符串，兼容 promptpile 的 TOML 加载逻辑）。
- 若存在 `messages/.tools.jsonl`，自动删除（避免和 `.tools.toml` 互斥）。

`run-example.bat` 启动时若发现 `messages/.tools.toml` 不存在，会自动跑一次该脚本。

## 补齐历史 result.jsonl

当 `messages/` 下存在 `[idx]assistant.calls.jsonl` 但对应的 `[idx]assistant.result.jsonl` 缺失时，可用这个脚本批量补齐（after-hook 内部也是它）：

```bash
cd examples
bun promptpile-tool-test/scripts/generate-tool-results.ts
```

行为约束：

- 仅处理 **缺失整份 `result.jsonl`** 的 idx；result 已存在则整轮跳过。
- 解析 `[idx]assistant.calls.jsonl` 的三种合法形态（含 `tool_calls` 的对象 / 根级数组 / JSONL 每行一个），与 promptpile README 一致。
- 按 call 文件中的原始顺序，对每个有效 tool call 调用 [scripts/execute-tool-call.ts](scripts/execute-tool-call.ts) 中导出的 `executeToolCall(input)`。
- 拼出 `[idx]assistant.result.jsonl`，每行一个 `{ tool_call_id, name, content }`。

排查问题时可在运行前设置环境变量 **`PROMPTPILE_DEBUG=1`**（或 `true`）：`promptpile` 会向 stderr 打出已加载工具名、模型返回的 `tool_calls` 名称等；`generate-tool-results` / `execute-tool-call` 会打出每条调用的工具名、参数预览与已注册工具列表（未知工具时）。`after-hook.bat` 在 **`PROMPTPILE_DEBUG=1`** 时会 echo 若干 `PROMPTPILE_*` 变量。

某条调用抛错时会写入 `"[execute error] <message>"`，脚本继续处理下一条，并以非 0 退出码结束。

## Behavior（chat-loop 风格）

- 若 `.env` 不存在则从 `.env.example` 同步。
- 若 `messages/.tools.toml` 不存在，会先自动在 `examples/` 下执行 `bun promptpile-tool-test\scripts\generate-tools-toml.ts` 生成。
- 进入 `:loop`，每轮执行：

  ```bat
  npx promptpile --config promptpile.toml --input --continue --after-hook-path "after-hook.bat"
  ```

  - `--input`：在终端读取本轮 user 消息（结尾用 Ctrl+Z 后回车），落盘成 `messages/[N]user.md`。
  - `--continue`：根据本轮模型输出落盘（两种文件**可共存**于同一 `[N]`）：
    - 有正文：写 `messages/[N]assistant.md`。
    - 有 `tool_calls`：写 `messages/[N]assistant.calls.jsonl`。
    - 同时有正文和 `tool_calls`：两个文件都写，下一轮拼请求时合并为一条 `{ role: 'assistant', content, tool_calls }`。
    - 都没有：不写。
  - `--after-hook-path`：见下。
- 每轮结束后会问 `Continue? (Y/N)`；输入 `Y` 继续，其余退出。

## Tool call → result 自动闭环（after-hook）

- run-example 用 `--after-hook-path after-hook.bat` 启用 promptpile 的完成后钩子（路径相对运行 promptpile 时的 cwd，即 `promptpile-tool-test/`）。
- 钩子由 promptpile **在 API 成功且本轮落盘完成后** 触发，cwd 被设为 `messages/`（`PROMPTPILE_SCAN_DIRECTORY`）。`PROMPTPILE_HAS_TOOL_CALLS=1` 时，本轮的 `[N]assistant.calls.jsonl` 已经由 `--continue` 写好，钩子无需再复制。
- [after-hook.bat](after-hook.bat) 行为：
  1. 若 `PROMPTPILE_HAS_TOOL_CALLS` 不为 `1`，直接 `exit /b 0`。
  2. 否则 `pushd` 到 `examples/`，执行 `bun promptpile-tool-test\scripts\generate-tool-results.ts`；由 [scripts/execute-tool-call.ts](scripts/execute-tool-call.ts) 真正执行工具并写出与 `[N]assistant.calls.jsonl` 同 idx 的 `[N]assistant.result.jsonl`。
  3. 透传 `generate-tool-results.ts` 的退出码。
- 想退回纯生成模式（只让 promptpile 写 `[N]assistant.calls.jsonl`，由人工事后跑 `bun scripts/generate-tool-results.ts`），从 [run-example.bat](run-example.bat) 删掉 `--after-hook-path "after-hook.bat"` 即可。
- `[0]system.md` 要求使用 **`SearxngSearch`**（与 `messages/.tools.toml`、[scripts/execute-tool-call.ts](scripts/execute-tool-call.ts) 一致）。若模型仍返回未注册的工具名，`generate-tool-results.ts` 会以非 0 退出（after-hook 随之失败）；请对照 stderr 里的 `[promptpile] Model tool_calls:` 与已加载工具列表排查。

## 预期产物（全部落在 `messages/`）

同一 `[N]` 下可能出现以下任意子集，下一轮拼请求时会合并为单条 `assistant`（必要时再加若干 `tool` 消息）：

- `messages/[N]assistant.md` —— 模型本轮的正文（包括 tool_calls 之前可能输出的「我来查询…」之类前缀）。
- `messages/[N]assistant.calls.jsonl` —— 由 `promptpile --continue` 写入；每行一个 `tool_call`，例如：

  ```json
  {"id":"call_xxx","type":"function","function":{"name":"SearxngSearch","arguments":"{\"query\":\"北京 今天 天气\"}"}}
  ```

- `messages/[N]assistant.result.jsonl` —— 由 after-hook 触发的 `generate-tool-results.ts` 写入；每行一个 `{ tool_call_id, name, content }`。

如果某轮没有任何 assistant 文件，说明模型返回为空（既没有 tool_calls 也没有正文）；可调整 `messages/[0]system.md` / 上一条 `[N]user.md` 再试。
