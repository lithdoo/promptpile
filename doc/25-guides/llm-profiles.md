# LLM Profiles

> 类型：Guide  
> 目标：复用同一份 `[[llm_api]]` profile database，并让不同 phase 只传 profile 名称

## Profile 示例

```toml
[[llm_api]]
name = "reasoning"
model = "MODEL_A"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
temperature = 0.2

[[llm_api]]
name = "fast"
model = "MODEL_B"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
temperature = 0.8
```

单独使用 profile database：

```bash
promptpile -d messages --disable-tool \
  --llm-config app.toml --llm-api reasoning
```

`--llm-config` 不等价于完整 `--config`：它只提供 `[[llm_api]]` 数据库，避免 orchestrator phase 被 `[promptpile]` 的 directory/output/tool 等 runtime 设置污染。

显式 CLI override 优先，例如：

```bash
promptpile --llm-config app.toml --llm-api reasoning --temperature 0.1
```

canonical 语义见 [CLI Contract v1](../15-contracts/cli-contract-v1.md)。
