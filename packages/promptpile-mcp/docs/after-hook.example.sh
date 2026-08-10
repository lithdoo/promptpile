#!/usr/bin/env bash
# 示例：供 promptpile `--after-hook-path` (or an explicitly enabled default `.after-hook.sh`) 调用。
# 依赖：已单独启动 `promptpile-mcp launch`，且本脚本可从 PATH 找到 `promptpile-mcp`。
#
# 约定环境变量（自建）：
#   PROMPTPILE_MCP_BASE_URL  必填方可执行，例如 http://127.0.0.1:8765
#   PROMPTPILE_MCP_TOKEN     可选，与 launch [gateway].token 一致
#
# promptpile 注入变量（见 ../../promptpile/src/after-hook.ts buildPromptpileHookEnv）：
#   PROMPTPILE_HAS_TOOL_CALLS       本次是否有 tool_calls（'1' / '0'）
#   PROMPTPILE_ASSISTANT_CALL_FILE  --continue 写入 output directory 的 calls 绝对路径
#   PROMPTPILE_CALLS_FILE           -o 主输出旁 *.calls.jsonl（若有）

set -euo pipefail

if [[ -z "${PROMPTPILE_MCP_BASE_URL:-}" ]]; then
  echo "promptpile-mcp after-hook example: PROMPTPILE_MCP_BASE_URL unset, skip exec-calls" >&2
  exit 0
fi

if [[ "${PROMPTPILE_HAS_TOOL_CALLS:-0}" != "1" ]]; then
  exit 0
fi

CALLS="${PROMPTPILE_ASSISTANT_CALL_FILE:-}"
if [[ -z "$CALLS" ]]; then
  CALLS="${PROMPTPILE_CALLS_FILE:-}"
fi
if [[ -z "$CALLS" ]]; then
  echo "promptpile-mcp after-hook example: no calls artifact path, skip" >&2
  exit 0
fi

ARGS=(exec-calls --base-url "$PROMPTPILE_MCP_BASE_URL" --input "$CALLS")
if [[ -n "${PROMPTPILE_MCP_TOKEN:-}" ]]; then
  ARGS+=(--token "$PROMPTPILE_MCP_TOKEN")
fi

exec promptpile-mcp "${ARGS[@]}"
