# @agent-tool-lite/base

`agent-lite-tools` 体系的基础契约包，提供跨包共享的工具定义类型与最小 JSON Schema 类型子集。

## 导出总览

本包对外提供四类核心类型：

- `JsonSchemaLike`
- `JsonObjectSchema`
- `ToolExecuteContext`
- `AgentToolDefinition<TInput, TOutput, TContext>`

完整导出请以 `src/index.ts` 为准。

## 快速开始

```ts
import type {
  AgentToolDefinition,
  JsonObjectSchema,
  ToolExecuteContext,
} from '@agent-tool-lite/base'

type EchoInput = {
  text: string
}

type EchoOutput = {
  echoed: string
  cwd?: string
}

type EchoContext = ToolExecuteContext & {
  requestId?: string
}

const echoInputSchema: JsonObjectSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Text to echo back' },
  },
  required: ['text'],
  additionalProperties: false,
}

export const echoTool: AgentToolDefinition<EchoInput, EchoOutput, EchoContext> = {
  name: 'echo',
  description: 'Return input text as output',
  inputSchema: echoInputSchema,
  async execute(input, context) {
    return {
      echoed: input.text,
      cwd: context.cwd,
    }
  },
}
```

## 类型说明

### `JsonSchemaLike`

用于描述工具输入参数的最小 schema 联合类型，支持：

- `string`（可选 `description`、`enum`）
- `number`（可选 `description`）
- `integer`（可选 `description`）
- `boolean`（可选 `description`）
- `array`（`items` 必填）
- `object`（可选 `properties`、`required`、`additionalProperties`）

### `JsonObjectSchema`

`JsonSchemaLike` 中 `type: 'object'` 分支的提取类型，适合用于显式约束“工具输入必须为对象”。

### `ToolExecuteContext`

所有工具执行上下文的基础接口，默认字段：

- `cwd?`: 工具执行工作目录
- `signal?`: 可选中断信号（`AbortSignal`）

### `AgentToolDefinition<TInput, TOutput, TContext>`

统一工具契约，包含：

- `name`: 工具名称
- `description`: 工具说明
- `inputSchema`: 输入参数 schema（`JsonObjectSchema`）
- `execute(input, context)`: 工具执行函数，返回 `Promise<TOutput>`

## Schema 边界（非完整 JSON Schema）

`JsonSchemaLike` 是“够用即止”的最小子集，并非完整 JSON Schema 实现。当前不包含例如：

- `null` 类型
- 组合关键词（`oneOf`、`allOf`、`anyOf`、`not`）
- 字符串/数值约束（如 `minLength`、`pattern`、`minimum`、`maximum`）
- 数组 tuple 形态（按索引声明不同 `items`）
- `$ref`、`definitions` / `$defs`、`format`

如需上述能力，请在上层自行扩展类型或引入专用 schema 库。

## 在其他包中的定位

`@agent-tool-lite/base` 不提供具体工具实现，只定义跨包共享契约。  
例如 `file`、`search` 等包会基于这些类型实现各自的 `createXxxTool(...)` 工厂与 `execute(...)` 行为。

## 构建

```bash
cd agent-lite-tools/base
npm install
npm run build
```
