# 执行系统

> 层级：10 · Architecture  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：一次 Promptpile completion 的生命周期与 ownership  
> 最近复核：2026-08-05

```text
CLI / config
  ↓
resolve execution config
  ↓
preflight output + tools
  ↓
scan root-level conversation artifacts
  ↓
insert sidecars + scanned messages + append sidecars
  ↓
POST {baseURL}/chat/completions (stream=true)
  ↓
stream content + merge tool_calls
  ↓
optional output / calls / continue artifacts
  ↓
after-hook
```

## Ownership

Execution System 拥有 `[[llm_api]]` profile 的 canonical 解析、temperature/extra-body 校验、API key resolution、conversation 扫描、tools 加载、单次 Chat Completions 请求与 assistant/calls/continue 落盘。

它不拥有 agent loop、MCP session、tool execution 或 context compression policy。

## 单次请求原则

一次 `promptpile` root completion 对应一次模型请求。模型返回 tool calls 后，执行工具、写 result、再次 completion 都由调用者显式组合。这是 composability 的基础。
