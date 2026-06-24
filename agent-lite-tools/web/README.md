# @agent-tool-lite/web

面向 Agent 运行时的轻量 Web 工具包，当前提供 `WebFetch` 与 `SearxngSearch` 两个工具，支持网页抓取、SearXNG 搜索、二进制落盘，以及可选的二次模型摘要。

## 导出总览

本包对外分为三层能力：

- **总工厂**
  - `createWebTools(config?)`
- **单工具工厂**
  - `createWebFetchTool(aiConfigController, config?)`
  - `createSearxngSearchTool(searxngConfigController, aiConfigController)`
- **控制器与低层库**
  - `createAiConfigController(...)`
  - `createSearxngConfigController(...)`
  - `fetchUrlContent(...)`
  - `searchSearxng(...)`
  - `persistBinaryToTmp(...)`
  - `applySummaryByAi(...)`

完整导出请以 `src/index.ts` 为准。

## 快速开始（总工厂）

```ts
import { createWebTools } from '@agent-tool-lite/web'

const tools = createWebTools()

const out = await tools.webFetchTool.execute(
  {
    url: 'https://example.com',
    prompt: '提取页面核心结论',
  },
  { cwd: process.cwd() },
)

console.log(out.content)
await tools.dispose()
```

`createWebTools()` 返回：

- `webFetchTool`
- `searxngSearchTool`
- `setAiConfig(config)`
- `getAiConfig()`
- `setAiConfigFile(filePath?)`
- `getAiConfigSources()`
- `isAiSummaryEnabled()`
- `setSearxngConfig(config)`
- `getSearxngConfig()`
- `setSearxngConfigFile(filePath?)`
- `getSearxngConfigSources()`
- `isSearxngEnabled()`
- `setWebConfigFile(filePath?)`
- `dispose()`

## 单工具工厂（高级用法）

```ts
import {
  createAiConfigController,
  createSearxngConfigController,
  createWebFetchTool,
  createSearxngSearchTool,
} from '@agent-tool-lite/web'

const aiConfig = createAiConfigController()
const searxngConfig = createSearxngConfigController({
  baseUrl: 'http://127.0.0.1:8080',
})
const webFetchTool = createWebFetchTool(aiConfig)
const searxngSearchTool = createSearxngSearchTool(searxngConfig, aiConfig)
```

这种模式适合：

- 只注册 `WebFetch` 一个工具；
- 只注册 `WebFetch` 或 `SearxngSearch` 其中之一；
- 宿主已有自己的工具装配层；
- 多个工具共享同一份 AI 配置控制状态。

## SearXNG 配置控制

`createSearxngConfigController` 支持手工配置与文件配置。

### `setSearxngConfig(config)`

- 设置手工 SearXNG 配置。
- 可用字段：`baseUrl`、`searchPath`、`timeoutMs`、`defaultLimit`、`maxLimit`、`defaultLanguage`、`defaultSafeSearch`、`defaultCategories`、`defaultEngines`。

### `setSearxngConfigFile(filePath?)`

- 从文件加载 SearXNG 配置，并监听 `add/change/unlink`。
- 传空值可取消文件来源并停止监听。

### `setWebConfigFile(filePath?)`

- 同一份 `.env` 风格文件同时加载 AI 与 SearXNG 配置。
- 适合统一管理 `AI_*` 与 `SEARXNG_*` 键。

## AI 配置控制

`createAiConfigController` 支持手工配置与文件配置，两种来源会合并为最终配置。

### `setAiConfig(config)`

- 设置手工 AI 配置。
- 可用字段：`model`、`apiKey`、`apiBaseUrl`。

### `setAiConfigFile(filePath?)`

- 从文件加载 AI 配置，并监听 `add/change/unlink`。
- 传空值可取消文件来源并停止监听。

文件格式（`.env` 风格）：

- 每行一个 `KEY=VALUE`
- 空行忽略
- `#` 注释行忽略
- 仅识别：
  - `AI_MODEL`
  - `AI_API_KEY`
  - `AI_API_BASE_URL`
  - `SEARXNG_BASE_URL`
  - `SEARXNG_SEARCH_PATH`
  - `SEARXNG_TIMEOUT_MS`
  - `SEARXNG_DEFAULT_LIMIT`
  - `SEARXNG_MAX_LIMIT`
  - `SEARXNG_DEFAULT_LANGUAGE`
  - `SEARXNG_DEFAULT_SAFE_SEARCH`
  - `SEARXNG_DEFAULT_CATEGORIES`（逗号分隔）
  - `SEARXNG_DEFAULT_ENGINES`（逗号分隔）

示例：

```env
AI_MODEL=gpt-4o-mini
AI_API_KEY=sk-xxx
AI_API_BASE_URL=https://api.openai.com/v1
SEARXNG_BASE_URL=http://127.0.0.1:8080
SEARXNG_SEARCH_PATH=/search
SEARXNG_DEFAULT_ENGINES=bing,duckduckgo
```

### `getAiConfigSources()`

返回：

- `manual`：手工配置
- `file`：文件配置
- `merged`：最终生效配置
- `aiConfigFile`：当前配置文件路径（可选）

### 生效规则

- `merged` 中同名字段默认由手工配置覆盖文件配置。
- 当 `model`、`apiKey`、`apiBaseUrl` 三项都存在时，`isAiSummaryEnabled()` 才为 `true`。
- 当 `baseUrl` 存在时，`isSearxngEnabled()` 为 `true`。
- 二次模型摘要失败时会降级返回原始抓取内容，不影响主流程返回。

## 执行上下文（WebToolExecuteContext）

`webFetchTool.execute` 支持：

- `cwd`：工作目录（可选）
- `signal`：中断信号（可选）

## WebFetch 行为说明

- 输入：`url` + `prompt`（两者必填）。
- URL 规则：仅支持 `http/https`，会自动把 `http` 升级到 `https`。
- 重定向策略：同 host（含 `www` 变体）可跟随；跨 host 返回重定向提示，不盲目跟随。
- 文本内容：`text/html` 自动转 Markdown，按字符上限截断并标记 `truncated`。
- 二进制内容：写入系统临时目录并返回 `persistedPath`。
- 可选摘要：当 AI 配置完整时，调用 OpenAI 兼容接口生成 `summary`。

## SearxngSearch 行为说明

- 输入：`query` 必填；支持 `page`、`limit`、`categories`、`engines`、`language`、`safeSearch`、`timeRange`、`summaryPrompt`。
- 请求：调用 `SEARXNG_BASE_URL + /search`，固定 `format=json`。
- 输出：结构化返回 `results`，包含 `title/url/content/engine` 等字段。
- 可选摘要：当提供 `summaryPrompt` 且 AI 配置完整时，输出 `summary`。
- 摘要失败：仅填 `summaryError`，不影响 `results` 返回。

## 构建与测试

```bash
cd agent-lite-tools/web
npm install
npm run build
npm test
```
