# 第一次对话

> 类型：Guide  
> 目标：从空目录跑通一次 Promptpile completion

## 1. 准备消息目录

```bash
mkdir -p demo/messages
cat > demo/messages/'[0]system.md' <<'EOF'
You are a concise assistant.
EOF
cat > demo/messages/'[1]user.md' <<'EOF'
Explain why file-based conversation state is useful.
EOF
```

## 2. 准备配置

```toml
# demo/promptpile.toml
[promptpile]
dir = "messages"
disable_tool = true

[[llm_api]]
name = "default"
model = "YOUR_MODEL"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
```

## 3. 执行

```bash
cd demo
export OPENAI_API_KEY='...'
promptpile --config promptpile.toml --llm-api default
```

一次 root invocation 只发起一次 completion。要把 assistant reply 写回 conversation，使用 `-c`；要只追加一条 user message 而不调用模型，使用：

```bash
printf '%s' '下一条问题' | promptpile conversation append-user -d messages
```

文件命名和排序的完整规则见 [Conversation Protocol v1](../15-contracts/conversation-protocol-v1.md)。
