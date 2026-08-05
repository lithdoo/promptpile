# CLI Contract v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：orchestrator / shell automation 使用的 machine-facing CLI 边界  
> 被以下组件实现：`promptpile`；被 `promptpile-react` 使用  
> 最近复核：2026-08-05

## Root completion

`promptpile` root command 是单次 completion 路径。它解析 runtime config、profile、conversation、tools，并发起一次模型请求。

## Conversation domain command

```bash
promptpile conversation append-user -d <directory> [-q]
```

- stdin：完整 user message；空/纯空白输入失败；
- success：写入下一条 user artifact；
- `-q`：成功时不输出普通 stdout；
- 不读取 completion API key；
- 不加载 tools；
- 不调用模型；
- failure：非零退出并写 stderr。

## LLM profile selector

```text
--llm-config <path>
--llm-api <name>
--api-key-env <name>
```

`--llm-config` 只把 TOML 当作 `[[llm_api]]` profile database；`--llm-api` 选择命名 profile；`--api-key-env` 把环境变量名称交给 Promptpile 读取，orchestrator 不需要读取 secret。

## Override 原则

显式 CLI 字段覆盖 config/profile 中同一字段。temperature precedence：

```text
--temperature
> [promptpile].llm_api_temperature
> selected [[llm_api]].temperature
> default 0.8
```

`extra_body` 同样由显式 CLI override 优先。

## Process contract

- `0`：成功；
- 非 `0`：调用方必须视为失败；
- stdout：正常输出/流式正文；
- stderr：diagnostic、warning、error；
- `-q`：减少普通终端输出，不改变文件 side effects 的成功语义。

Machine consumer 不应依赖未文档化的自然语言日志文本。

## Binary resolution

`promptpile-react` 默认从依赖包 `promptpile/package.json` 的 `bin.promptpile` 解析 **Node-compatible entry script**，再用当前 `process.execPath` 启动；不假定固定 `dist/index.js`。原生 executable/wrapper 用 `PROMPTPILE_BIN` 覆盖。
