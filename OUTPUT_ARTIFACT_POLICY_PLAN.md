# Promptpile Output Artifact Policy 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：用统一内部模型说明 stdout、主输出、Conversation artifacts、output pile 和 receipt 的关系

## 1. 动机

Promptpile 当前拥有多条互补输出路径：stdout、`-o`、`--continue`、output pile、calls/extra sidecars 和 after-hook。单项规则已经文档化，但组合配置容易让调用者不清楚哪些输出是权威 artifact、哪些是流式通道、哪些只用于诊断。

本提案优先整理内部模型和文档，不急于引入一个复杂的新 CLI 对象。

## 2. 统一模型

```ts
interface OutputArtifactPolicy {
  terminal: {
    quiet: boolean;
  };
  conversation: {
    enabled: boolean;
    outputDirectory?: string;
  };
  mainOutput?: {
    path: string;
  };
  stream?: {
    file?: string;
    fd?: number;
    format: 'text' | 'json';
  };
  receipt?: {
    path: string;
  };
}
```

它由现有 CLI/TOML options 解析得到，而不是替换现有兼容入口。

## 3. 通道分类

| 通道 | 用途 | 是否权威 artifact |
| --- | --- | --- |
| stdout | 人工可见流式正文/调用提示 | 否 |
| stderr | warning/error/diagnostic | 否 |
| `-o` 主输出 | 调用者指定的普通结果文件 | 是，由调用者管理 |
| `--continue` artifacts | Conversation Protocol 历史 | 是 |
| output pile | 实时旁路流 | 否，允许截断 |
| receipt | 已完成 artifact 的索引 | 否，引用权威文件 |

## 4. 组合规则

- `-q` 只关闭普通终端输出，不关闭其它文件通道。
- `-o` 与 `--continue` 可以同时启用，分别写普通输出和 Conversation artifact。
- output pile 可以与 quiet 同时使用。
- receipt 必须最后写入，并引用实际成功生成的输出。
- `--output-dir` 只改变 Conversation artifacts 的写入位置，不改变 `-o` 和 output pile 路径。
- after-hook 在模型输出和 Conversation artifacts 写入后执行。

### Post-model OCC conflict

`--continue` 使用 expected output condition 时，模型返回后仍可能因为 Conversation 已变化而以 exit code `3` 冲突。各通道语义固定为：

- stdout 和 output pile 是实时通道，已经发送的内容不撤回；output pile 的模型完成事件仍表示模型流已完成，不表示 Conversation commit 成功；
- 已成功写入的 `-o` 主输出及其 calls/extra sidecar 不回滚；
- 本轮 assistant Conversation artifacts 不写入；
- after-hook 不执行；
- `--input --continue` 中此前已 commit 的 user artifact 保留。

需要同时判断模型结果与 Conversation commit 的机器调用方，后续应消费 Completion Receipt；OCC v1 不把 receipt 作为正确性前置条件。

## 5. 诊断能力

可以增加只解析配置、不调用模型的命令：

```bash
promptpile config explain-output --config ./promptpile.toml --format json
```

或者先仅在 debug 日志中打印脱敏后的 resolved policy。第一版不一定需要新命令。

## 6. 非目标

- 不删除或重命名现有 CLI options。
- 不把所有输出强制合并成一个 JSON event stream。
- 不让 output pile 成为完成事实来源。
- 不改变 Conversation Protocol 的正文语义。
- 不在 policy 中加入业务 session/run 状态。

## 7. 实施计划

- 盘点现有 config precedence 和所有输出组合。
- 在内部建立单一 resolved output policy。
- 让 index、output-pile、continue、after-hook 和 receipt 使用该模型。
- 为组合矩阵添加测试，特别是 quiet + output pile + continue + receipt。
- 更新 CLI Contract，用一张通道分类表替代分散解释。
- 在稳定后再评估是否公开 `[promptpile.output_policy]` 配置表。

## 8. 验收标准

- 现有 CLI 行为保持兼容。
- 每个输出通道的成功、失败和原子性语义有唯一文档定义。
- 任意合法组合都能在测试中确定预期文件集合。
- `-q` 不再被误解为机器结果模式或禁用文件输出。
- receipt 和 after-hook 获得同一套实际 artifact paths。

## 9. 待定项

- 是否最终公开嵌套 TOML policy，还是永远只作为内部模型。
- 主输出与 Conversation artifact 内容是否允许不同编码/格式。
- output pile error 是否影响 completion 退出状态。
- 多个文件输出中任意一个失败时的停止顺序。
