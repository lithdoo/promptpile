# promptpile-mcp launcher

最小示例：在本机启动 **`promptpile-mcp launch`**，stdio 连接 **filesystem**（本地允许目录）、**fetch**（轻量 URL→Markdown）与 **Playwright**（真实浏览器，适合 JS 渲染与交互）等 MCP，HTTP 网关聚合工具列表。

## 前置条件

- **Node.js 18+**；使用 **Playwright MCP** 时官方建议 **Node.js 20+**（见 [Playwright MCP 安装说明](https://playwright.dev/mcp/installation)）。
- 已在 **`examples/`** 执行 **`npm install`**；`promptpile-mcp` 由本目录的 `package.json` 通过本地 `file:` 依赖安装。
- 已在仓库根目录执行 **`npm install`** 和 **`npm run build`**，并在 **`examples/`** 目录执行 **`npm install`**。filesystem 与 Playwright 服务由 `mcp.toml` 中的 **`npx --no-install`** 从 `examples/node_modules` 启动。
- **Fetch MCP**：官方实现通过 **Python / uv** 分发（[`mcp-server-fetch`](https://pypi.org/project/mcp-server-fetch/)），**npm 上不存在** `@modelcontextprotocol/server-fetch`。本示例在 `mcp.toml` 中使用 **`uvx mcp-server-fetch`**。Windows 可在本目录运行 **`install-uv.bat`**（调用 [Astral 官方安装脚本](https://docs.astral.sh/uv/getting-started/installation/)，需联网），安装后一般会包含 **`uv`** / **`uvx`**；也可自行按 [uv 文档](https://docs.astral.sh/uv/) 安装。
  - 若本机尚无 Python，可运行 **`install-python.bat`**：当 **`python`** 不在 PATH 时，通过 **winget** 安装 **Python 3.14**（包 ID `Python.Python.3.14`；需已安装 **winget**，可能出现 UAC）。本示例 fetch 仍以 **`uvx`** 为准；Python 可用于 pip 场景或将 **`mcp.toml`** 中 fetch 改为官方文档里的 **`python -m mcp_server_fetch`** 等形式。
  - **明明终端里能跑 `uvx`，但网关仍报 fetch 失败 / `server_down:fetch`？** MCP SDK 只会把**当前 Node 进程**的 `PATH` 传给子进程；从某些 IDE 启动时，进程里的 PATH 可能比「新开 cmd」旧。**`run-example.bat`** 已在启动前从注册表合并 **系统 + 用户** Path，一般即可找到刚安装的 `uvx`。若仍失败，请在新开的 **cmd** 里执行 `where uvx`，确认路径后再运行 bat，或完全退出 IDE 后重开。
  - 若未安装 `uv`，在 **`failure_policy = "best-effort"`** 下 fetch 服务会被跳过，**filesystem 仍可用**。
- **Playwright MCP**（[`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp)）：`mcp.toml` 中为 **`npx --no-install @playwright/mcp --headless`**（无界面浏览器）。首次使用浏览器能力时可能自动下载浏览器二进制，体积与耗时较大。不需要 Playwright 时可删除 **`[servers.playwright]`** 整段以减轻启动负担。
- 可选：仅使用 filesystem 时，可编辑 **`mcp.toml`** 删除或注释 **`[servers.fetch]`** 整段，避免日志中的跳过提示。

## 运行

**终端 A**（本目录）：

```bat
run-example.bat
```

网关默认监听 **`http://127.0.0.1:8765`**（见 `mcp.toml` 中 `[gateway].port`）。

**终端 B**（在任意目录，已在 `examples/` 安装依赖）：

```bat
cd /d path\to\promptpile\examples\promptpile-mcp-launcher
npx --no-install promptpile-mcp export-tools --base-url http://127.0.0.1:8765
```

应生成当前目录下的 **`.tools.toml`**，工具名形如 **`mcp__fs__…`**、**`mcp__fetch__…`**、**`mcp__playwright__…`**（见 promptpile-mcp 文档中的命名规则）。

可选探活：

```bat
curl http://127.0.0.1:8765/health
```

若在 `[gateway]` 配置了 **`token`**，请在 **`export-tools`** 上增加 **`--token`**，与 launch 侧一致。

## 安全说明

- **Filesystem**：仅允许访问本目录下的 **`allowed/`**（在 `mcp.toml` 的 `args` 最后一项）。需要其它根路径时请改为**绝对路径**并重启 launch。
- **Fetch**：可请求任意 URL，存在 **SSRF / 内网访问** 风险，请勿在生产环境随意暴露网关。
- **Playwright**：可导航并操作页面，风险不低于 fetch；请仅在本机 **`127.0.0.1`** 使用，必要时为网关配置 **`[gateway].token`**。
- 生成的 **`.tools.toml`** 若不想提交到 Git，可自行加入 `.gitignore`。

## 端口冲突

若 `8765` 已被占用，修改 **`mcp.toml`** 中的 **`[gateway].port`**，并在 **`export-tools`** / **`curl`** 中使用同一端口。
