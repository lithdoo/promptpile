# promptpile-mcp + promptpile-react

本示例提供 **`run-example.bat`**：自动探活或启动 MCP 网关、在 **`messages/`** 下准备会话与 **`messages\.tools.toml`**，再以 **`promptpile-react --config promptpile-react.toml`** 运行（终端多轮输入）。默认 LLM 为 **DeepSeek**（在 TOML 的 `[[llm_api]]` 中配置）。

根目录下的 **`.react.*.md`** 为 ReAct 提示词；由 TOML 的 `thought_prompt` / `observe_prompt` / `check_prompt` / `final_prompt` 引用（相对 `messages/` 的 `..`），**不复制**到 `messages/`。

## ReAct 流程（每轮）

```text
Thought（MCP tools + after-hook exec-calls）
  → Observe（全量 messages，纯文本观察报告，不写回目录）
  → Check（仅读观察报告 + react_check_decision，决定是否继续）
  →（继续则下一轮 Thought，否则 Final）
```

- **Observe** 子进程 **`--disable-tool`**，不调用 `react_observe_decision`（已废弃）。
- **Check** 子进程使用空扫描目录 + **`--insert-files`**（check 提示 + 观察报告正文），强制 **`react_check_decision`**。
- 自定义 observe 提示若仍要求 `react_observe_decision` **无效**；决策逻辑须写在 **`.react.check.md`**。

## 前置条件

- **Node.js 18+**；使用 Playwright MCP 时建议 Node 20+（见 [`promptpile-mcp-launcher`](../promptpile-mcp-launcher/README.md)）。
- 已在 **`examples/`** 执行 **`npm install`**；`promptpile`、`promptpile-mcp` 与 `promptpile-react` 由本目录的 `package.json` 通过本地 `file:` 依赖安装；**`promptpile-react` 默认通过依赖内置 `promptpile/dist/index.js`** 调用 CLI，无需全局 **`promptpile`**（可选 **`PROMPTPILE_BIN`** 覆盖），详见 **`packages/promptpile-react/README.md`**。
- **`curl`** 可用于探测网关 **`/health`**（Windows 10+ 自带）。
- 运行前在**用户或系统环境**中设置 **`DEEPSEEK_API_KEY`**（与 TOML 中 `api_key_env` 一致）。

## 端口

脚本内 **`MCP_PORT=8765`** 须与 [`promptpile-mcp-launcher/mcp.toml`](../promptpile-mcp-launcher/mcp.toml) 中 **`[gateway].port`** 一致；若修改一端，请同步修改 **`run-example.bat`** 顶部变量。

## 配置

编辑本目录 **`promptpile-react.toml`**：

| 区域 | 说明 |
|------|------|
| **`[[llm_api]]`** | 模型、`base_url`；密钥通过 **`api_key_env`** 从环境变量读取，勿写入仓库 |
| **`[promptpile-react]`** | `dir`、`tools_file`、`after_hook`、`max_step`、`input` / `continue`、各阶段提示词与 `*_llm_api_*` 等 |

| 提示词文件 | 阶段 | TOML 键 |
|----------|------|---------|
| `.react.core.md` | Thought | `thought_prompt` |
| `.react.observe.md` | Observe（纯文本报告） | `observe_prompt` |
| `.react.check.md` | Check（`react_check_decision`） | `check_prompt` |
| `.react.final.md` | Final | `final_prompt` |

`observe_llm_api_temperature` / `check_llm_api_temperature` 等可分别为 Observe、Check 指定 LLM profile 覆盖（未设时回退 `llm_api` 默认链）。

运行前设置系统环境变量 **`DEEPSEEK_API_KEY`**。若使用 **`setx`**，须**新开终端**后变量才会出现在会话里。

可选 MCP 鉴权：在 [`promptpile-mcp-launcher/mcp.toml`](../promptpile-mcp-launcher/mcp.toml) 配置 **`[gateway].token`**，并设置环境变量 **`PROMPTPILE_MCP_TOKEN`**（供 **`export-tools`**、after-hook **`exec-calls`** 与文末手动命令；`run-example.bat` 不会从文件加载该变量）。

## After-hook：自动 `exec-calls`

TOML 中 **`after_hook = "../after-hook-mcp-exec-calls.bat"`**（相对扫描目录 `messages/`）。**`run-example.bat`** 在启动 react 前设置 **`PROMPTPILE_MCP_BASE_URL`**，供 hook 调用网关。

- **触发时机**：仅在 **Thought** 阶段的 **`promptpile`** 成功结束后（**Observe**、**Check** 与 **Final** 不带 after-hook，见 **`packages/promptpile-react`**）。
- **行为**：若 **`PROMPTPILE_HAS_TOOL_CALLS=1`**（由 **`promptpile`** 注入），则调用 **`promptpile-mcp exec-calls`**，将 **`messages/`** 下 **`*.calls.jsonl`** 转为 **`*.result.jsonl`**。
- **网关**：**`launch`** 须保持运行；否则 **`exec-calls`** 会失败。

## 调试

**[`run-example.bat`](run-example.bat) 已默认设置 `PROMPTPILE_REACT_DEBUG=1`**，无需手动 export。

- **stderr**：`[promptpile-react] phase=thought` / `phase=observe` / `phase=check continue=true|false` 等。
- **LLM dump**：每个 Thought / Observe / Check / Final 子进程在 **本目录根**（与 `promptpile-react.toml` 同级，**不是** `messages/`）写入 `{timestamp}-{rand}.req.json` 与 `.res.json`；JSON 内 **`tag`** 为 `thought` / `observe` / `check` / `final`（见 [`packages/promptpile-react/README.md`](../../packages/promptpile-react/README.md)）。成功响应的 `.res.json` 在 thinking 模型下可含 **`reasoning_content`** 字段。
- **Thinking 历史**：Thought / Final 在 `continue=true` 时，若模型返回 `reasoning_content`，会在 **`messages/`** 写入同序号 **`[N]assistant.extra.json`**（与 `[N]assistant.md` / `.calls.jsonl` 并列），供下一轮请求回传，避免 DeepSeek 400。
- **关闭 dump**：编辑 `run-example.bat`，注释掉 `set "PROMPTPILE_REACT_DEBUG=1"` 那一行。
- **在 IDE 中查看**：[`.gitignore`](.gitignore) 已忽略 `*.req.json` / `*.res.json`，需在资源管理器打开本目录，或开启「显示 gitignore 忽略的文件」。

## 运行

1. 在本目录执行 **`run-example.bat`**。
2. 若 **`http://127.0.0.1:8765/health`** 不可用，脚本会 **另开窗口** 启动 [`promptpile-mcp-launcher`](../promptpile-mcp-launcher/)，并轮询直至就绪（约最长 62 秒）。
3. 脚本生成 **`messages\.tools.toml`**（依赖已运行的网关），然后启动 **`promptpile-react --config promptpile-react.toml`**。
4. 按提示输入用户消息；每轮结束后 **Ctrl+Z** 再 **Enter**（Windows）提交输入（与 **stdin** 约定一致）。

### 验证建议

1. 问「某目录里有哪些文件」类问题：Thought 产生 MCP calls → after-hook **`exec-calls`**。
2. Observe 报告应在 **缺失** 中写明未 list 目录（若仅 allowed dirs）。
3. Check 应对缺口返回 **`decision: true`**，继续下一轮；目标满足后 **`decision: false`** → Final。

模型若产生 MCP **`tool_calls`**，**Thought** 结束后 **after-hook** 会尝试 **`exec-calls`**。仍可在网关运行时 **手动重试**：

```bat
npx --no-install promptpile-mcp exec-calls --base-url http://127.0.0.1:8765 --dir "%CD%\messages"
```

（若配置了 token，追加 **`--token`**，与 **`PROMPTPILE_MCP_TOKEN`** 相同。）

## 目录说明

| 路径 | 说明 |
|------|------|
| **`promptpile-react.toml`** | ReAct 编排与 LLM 配置 |
| **`.react.core.md` 等** | 示例根目录提示词；由 TOML `*_prompt` 引用 |
| **`messages/`** | 会话与 **`[idx]*.md`**、**`.tools.toml`**；默认被 **`.gitignore`** 忽略，勿提交密钥或私密对话 |
| **`messages\.tools.toml`** | 由 **`promptpile-mcp export-tools`** 生成，勿手工伪造 |
| **`after-hook-mcp-exec-calls.bat`** | **`promptpile`** after-hook：有 **`tool_calls`** 时 **`exec-calls`** |

详见 **`packages/promptpile-react/README.md`** 与 **`packages/promptpile-mcp/README.md`**。
