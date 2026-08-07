# Promptpile After-hook Failure Policy 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：为 after-hook 增加显式的失败处理策略，保留现有宽容行为并支持严格编排

## 1. 动机

当前 after-hook 启动失败或非零退出时只写诊断，Promptpile 主流程仍可能成功。人工脚本场景需要这种宽容行为，但当 hook 承担 `promptpile-mcp exec-calls` 等工具执行职责时，静默成功会让上层误判整个步骤已经完成。

## 2. 配置草案

```bash
promptpile \
  -d ./messages -c \
  --after-hook-path ./exec-calls.ps1 \
  --after-hook-failure error
```

```toml
[promptpile]
after_hook = "./exec-calls.ps1"
after_hook_failure = "error"
```

枚举：

- `warn`：兼容当前行为，输出诊断但 completion 保持成功。
- `error`：保留已写 artifacts，但最终返回非零退出。

默认值必须为 `warn`，避免破坏现有脚本。

## 3. 失败分类

至少区分：

- 显式 hook 路径不存在或不是普通文件；
- 进程 spawn 失败；
- hook 被 signal 终止；
- hook 非零退出；
- hook 超时；
- hook 成功。

第一版可以只在内部保留结构化分类，对用户仍通过 stderr 和退出码暴露。

## 4. 语义

`error` 模式下：

1. 模型调用成功产生的 artifacts 不回滚。
2. hook 失败后不删除 assistant/calls/extra。
3. Promptpile 返回非零退出。
4. stderr 指出失败类别、hook 路径和退出码，但不打印敏感环境变量。
5. 如果启用 Completion Receipt，receipt 记录 `hook_failed` 和已存在 artifacts。

这表示“completion 产生了可诊断 artifacts，但后处理没有完成”，不模拟跨文件事务。

## 5. 可选超时

后续可增加：

```bash
--after-hook-timeout-ms 60000
```

超时应终止 hook 进程树，而不只是父脚本。跨平台进程树管理需要单独设计；第一版可暂不加入 timeout，避免低质量实现。

## 6. 非目标

- 不把 Promptpile 变成 tool executor。
- 不解释 hook stdout 为业务协议。
- 不自动重试 hook。
- 不根据 hook 失败自动覆盖或补写 result artifacts。
- 不承诺回滚已经原子写入的 Conversation artifacts。

## 7. 实施计划

- 扩展 CLI/TOML 配置与校验。
- 让 `runAfterHook` 返回结构化结果，而不是永远 resolve `void`。
- 在 Promptpile 顶层根据 policy 设置最终退出状态。
- 接入 Completion Receipt（若该提案先落地）。
- 增加 spawn error、非零退出、signal 和兼容默认测试。
- 更新 CLI Contract、README 和 hook 安全文档。

## 8. 验收标准

- 未配置策略时行为与当前版本一致。
- `warn` 模式下 hook 失败保留零退出兼容语义。
- `error` 模式下 hook 失败导致非零退出。
- 两种模式都保留已经写入的 artifacts。
- 日志和 receipt 不泄露 API key 或完整 hook 环境。

## 9. 待定项

- hook 路径配置无效是否与执行失败使用同一错误码。
- hook stdout 是否应设置字节上限；当前实现会在内存累计。
- 是否增加 `ignore`，还是 `warn` 已足够。
- 是否为 hook 定义稳定的专用退出码范围。
