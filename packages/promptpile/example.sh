# example.sh — 仅作文档：列出 promptpile 与 example.toml [promptpile] 对齐的命令行写法（= 连接值）。
# 不执行。复制时去掉每行行首的「# 」并拼成一条命令（续行符 \ 须位于行末且无尾随空格）。
#
# promptpile \
#   --config=example.toml \
#   --directory=./message \
#   --output=./message/promptpile-example-output.md \
#   --after-hook-path=./after_hook.sh \
#   --tool-choice=auto \
#   --tools-file=./.tools.toml \
#   --input \
#   --insert-files=./inject.system.md \
#   --model= \
#   --api-key= \
#   --api-base-url=
#
# 各参数含义（与 example.toml 字段对应）：
# --config=example.toml — 单独指定 TOML 配置文件。
# --directory=./message — dir，消息扫描目录。
# --output=./message/promptpile-example-output.md — output 写文件路径。
# （quiet=false 不传 --quiet；为 true 时追加 --quiet）
# --after-hook-path=./after_hook.sh — after_hook，成功后脚本路径（CLI 相对 cwd）。
# --allow-default-after-hook — 仅当未显式配置 hook 时，允许发现消息目录根的默认 .after-hook.*；默认关闭。
# --tool-choice=auto — tool_choice。
# --tools-file=./.tools.toml — tools_file（CLI 相对 cwd）；仅 .toml，文件内可写 extends
# （disable_tool=false 不传 --disable-tool；为 true 时追加 --disable-tool）
# （continue=false 不传 --continue；为 true 时追加 --continue）
# --input — input=true，终端读入用户消息（无 = 值）。
# --insert-files=./inject.system.md — insert_files；多路径用 | 分隔；每文件须为 {name}.{role}.md。
# --append-files=./tail.user.md — append_files（可选）；规则同上，消息追加在扫描目录消息之后。
# --model= — llm_api_model，可与 toml 中 llm_api 所选 profile 合并。
# --temperature=0.7 — llm_api_temperature，覆盖 TOML/profile；未设置时默认 0.8。
# --extra-body='{"top_p":0.9}' — llm_api_extra_body，JSON 字符串，合并进请求体；未设置则不传。
# --api-key= — llm_api_key。
# --api-base-url= — llm_api_base_url。
# （llm_api 选用哪档 profile、llm_api_key_env 从其它环境变量名取密钥：无单独 CLI 时由 --config 读 TOML 普通配置不再从环境变量读取）
