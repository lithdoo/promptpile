# promptpile-plan

在 **`promptpile` 命令行**之上做 **plan → exec** 两阶段（或多阶段）编排的空项目脚手架，定位接近 sibling 包 **`promptpile-react`**：不把 `promptpile` 作为 npm 库依赖，而是通过子进程调用已安装的 **`promptpile`** 可执行文件。

## 目标（待实现）

| 阶段 | 意图 |
|------|------|
| **Plan** | 让模型或固定策略产出可执行计划（步骤、工具调用意图、验收条件等），写入消息目录或临时产物。 |
| **Exec** | 按计划驱动 `promptpile`（及可选工具/钩子），收集结果，再决定是否回到 Plan 修正或结束。 |

与 **ReAct**（thought / observe 循环）对照：**plan-and-exec** 强调先结构化计划再执行，而不是边想边观察的同构循环；具体 argv、提示词文件约定、与 `promptpile-react` 共用哪些 CLI 开关，由后续迭代定。

## 当前状态

- 仅含 **`promptpile-plan`** CLI 入口与 **`npm run build`**；**尚未**接线 `promptpile` 子进程与任何运行时类。
- 默认可执行文件名为 **`promptpile`**（`PATH` 或 **`PROMPTPILE_BIN`**），与 `promptpile-react` 对齐。

## 开发与构建

```bash
cd packages/promptpile-plan
npm install
npm run build
```

## 许可证

ISC
