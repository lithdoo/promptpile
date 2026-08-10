# example.sh — 仅作文档：列出 promptpile-react 与 example.toml 对齐的命令行写法（= 连接值）。
# 不执行。复制时去掉每行行首的「# 」并拼成一条命令（续行符 \ 须位于行末且无尾随空格）。
#
# promptpile-react \
#   --config=example.toml \
#   --max-step=10 \
#   --quiet
#
# （也可分层覆盖：--directory=./base --directory=./reference --output-dir=./session --continue）
# （其它覆盖：--model=chat --temperature=0.7 --extra-body='{"top_p":0.9}' --tools-file=./.tools.toml）
# （quiet=false 不传 --quiet；input/continue 为 true 时追加 --input / --continue）
#
# 含义：
# --config=example.toml — 父进程读取 [[llm_api]]、[promptpile-react]；[promptpile] 仅作共享键回退
# --max-step=10 — [promptpile-react].max_step（CLI 优先于 TOML）
# 子进程不传 --config；普通阶段由 buildPhaseArgv 显式拼重复 -d、--output-dir 和 LLM 参数；check 仅使用隔离临时目录
#
# [promptpile] 中的 output / tool_choice / insert_files 仅供裸跑 promptpile，react 模式忽略
#
# 提示词：TOML thought_prompt 等，或 conversation anchor 下 .react.core.md / .react.observe.md / .react.final.md
# 普通配置仅来自 CLI 与 TOML；密钥可由 TOML api_key_env 引用指定环境变量。
