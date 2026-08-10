# Tools TOML v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：Promptpile 工具文件的来源与组合规则  
> 被以下组件实现：`promptpile`；由 `promptpile-mcp export-tools` 生成  
> 最近复核：2026-08-10

## 显式来源

Promptpile 不自动探测消息目录默认工具文件。工具必须通过 `--tools-file <path>` 或 runtime TOML 的 `tools_file` 显式指定；否则使用 `--disable-tool`。

只支持 TOML tool definition source。

## 路径基准

| 来源 | 相对路径基准 |
| --- | --- |
| CLI `--tools-file` | `process.cwd()` |
| TOML `tools_file` | conversation anchor：output directory 优先，否则最后一个有效 input layer |
| `extends` | 当前工具 TOML 所在目录 |

CLI `--tools-file` 优先于 TOML `tools_file`。

## extends

根表可包含 `extends` 字符串或字符串数组。实现包含循环检测，并限制最大递归深度为 32（根深度 0）。

## Tool shape

```json
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "...",
    "parameters": {}
  }
}
```

MCP `tools/list` 的 `inputSchema` 可由 `promptpile-mcp export-tools` 映射为 `parameters`。
