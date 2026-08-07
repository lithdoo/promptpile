# Promptpile Invocation ID 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：允许调用者提供不进入模型上下文的 invocation correlation id

## 1. 动机

外层 orchestrator 需要把一个 Promptpile 子进程与自己的 run、日志、receipt 和 after-hook 关联。目前只能依赖 PID、临时路径或目录前后差集。把业务 runId 写入 Conversation message schema 又会污染通用协议。

Invocation ID 是一次进程调用的外部关联标签，不是 Conversation identity。

## 2. CLI 草案

```bash
promptpile \
  -d ./messages -c \
  --invocation-id run-01JXYZ
```

TOML 不建议支持 invocation id，因为它应由每次调用动态分配，而不是静态配置。

## 3. 传播范围

Invocation ID 可以进入：

- Completion Receipt；
-结构化 diagnostic context；
- after-hook 环境变量 `PROMPTPILE_INVOCATION_ID`；
-可选 LLM dump 文件 metadata；
- output pile JSON 的首尾 metadata（后续单独决定）。

Invocation ID 不进入：

- system/user/assistant prompt；
- Conversation artifact 文件名；
- Tool calls arguments；
- Archive Protocol；
-模型请求 body，除非调用者另外显式配置 provider metadata。

## 4. 校验

建议限制：

- UTF-8 可打印 ASCII 子集；
- 长度 1–128；
- 允许字母、数字、`.`、`_`、`-`、`:`；
- 不允许路径分隔符、控制字符和空白。

Promptpile 不负责保证全局唯一，只保证原样关联和安全输出。

## 5. 安全边界

- Invocation ID 是不可信调用者输入，日志中必须安全转义。
- 不得用它直接拼接文件路径；receipt 路径仍单独指定。
- 不得把它当授权身份、幂等键或锁 owner 的充分证明。
- 不得隐式注入模型上下文。

## 6. 非目标

- 不提供 exactly-once 或自动重试。
- 不定义 sessionId、operationId、worldId 等业务字段。
- 不要求现有 Conversation artifacts 增加 metadata sidecar。
- 不改变 Promptpile CLI 的退出语义。

## 7. 实施计划

- 增加 root completion CLI option 和校验。
- 将 id 放入运行时 diagnostic context。
- 暴露到 after-hook 环境。
- 与 Completion Receipt schema 集成。
- 增加非法字符、长度、日志转义和“不进入请求 body”测试。
- 更新 CLI Contract 和 security 文档。

## 8. 验收标准

- Invocation ID 可以关联 receipt 与 after-hook。
- 模型输入和 Conversation message 内容不因该参数变化。
- 非法 id 在模型调用前失败。
- id 不能造成路径穿越或日志换行注入。
- 不提供该参数时行为完全兼容。

## 9. 待定项

- output pile JSON 是否携带 invocation id。
- 子进程启动的 hook 是否还需要独立 hook invocation id。
- 是否允许 Unicode；第一版建议只允许受限 ASCII。
