# ReAct Agent

> 类型：Guide  
> 目标：使用 `promptpile-react` 运行 Thought → Observe → Check → Final

## 最小配置形状

```toml
[[llm_api]]
name = "default"
model = "YOUR_MODEL"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"

[promptpile-react]
dir = "messages"
llm_api = "default"
max_step = 3
```

运行：

```bash
promptpile-react --config app.toml
```

如果需要先从终端追加 user message：

```bash
promptpile-react --config app.toml -i
```

React 会通过 `promptpile conversation append-user` 完成 mutation，而不是 import Promptpile file handler。

## Phase 行为

- Thought：核心执行，可使用 tools。
- Observe：禁用 tools，产生纯文本观察。
- Check：独立临时上下文 + decision tool，决定是否继续。
- Final：可选收尾阶段，禁用 tools。

各 phase 可以只选择不同 profile 名；实际 profile 内容由 Promptpile 解析。架构细节见 [编排系统](../10-architecture/orchestration-system.md)。
