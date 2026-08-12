#!/usr/bin/env sh

# 单次 ReAct session；max_step 和 phase profile 来自 example.toml。
promptpile-react --config ./example.toml

# CLI 覆盖：最多两轮，读取一次终端输入，append 后运行一次 session。
# -c 只表示 Conversation continuation，不会形成无限输入循环。
promptpile-react --config ./example.toml --max-step 2 --input --continue

# 分层 Conversation：多个只读输入层 + 一个可写输出层。
promptpile-react \
  --directory ./base \
  --directory ./reference \
  --output-dir ./session
