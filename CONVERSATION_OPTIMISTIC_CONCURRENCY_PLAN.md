# Promptpile Conversation Optimistic Concurrency 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：为 Conversation mutations 提供可选 expected 条件，检测并发变化而不引入长期锁服务

## 1. 动机

Conversation Protocol 保证单文件原子提交，但不协调多个 writer 的 next idx。上层通常能串行调用，却仍可能因进程重启、误配置或外部脚本产生竞争。Promptpile 不需要因此拥有分布式锁；提供乐观并发前置条件已经能避免大量静默覆盖或顺序错误。

## 2. Append user 草案

```bash
promptpile conversation append-user \
  -d ./messages \
  --expected-next-index 9
```

执行前重新扫描目录：

- 实际 next idx 为 9：正常写入；
- 不为 9：非零退出，不写任何 artifact。

也可以使用更强条件：

```bash
--expect-fingerprint sha256:...
```

## 3. Completion continue 草案

```bash
promptpile \
  -d ./messages -c \
  --expected-output-next-index 10
```

需要注意模型请求期间 Conversation 可能变化。因此只在启动前检查一次不够：

1. 请求前验证 expected condition。
2. 模型返回后、写入前重新验证。
3. 不匹配则不写 `--continue` artifacts，并返回 conflict。
4. 如果同时启用 `-o` 或 output pile，它们可能已经产生输出；文档必须明确它们不是 Conversation commit。

## 4. Fingerprint 与 next idx

- `expected-next-index` 成本低，但不能检测旧文件原地变化。
- `expect-fingerprint` 检测整个协议视图变化，但需要读取和 hash 全部 artifacts。
- 两者可同时提供；调用者按风险选择。
- Layered 模式只对 writable output directory 设置 mutation condition；只读输入层可另行提供组合 fingerprint 作为请求前置条件。

## 5. 错误契约

冲突应使用稳定的非零退出码和机器可识别 receipt 状态，例如：

```json
{
  "status": "conflict",
  "expectedNextIndex": 10,
  "actualNextIndex": 11
}
```

stderr 提供简短诊断，但机器调用不解析自然语言文本。

## 6. 非目标

- 不提供悲观锁或长期 lease。
- 不自动重试模型调用。
- 不在冲突时覆盖现有 artifacts。
- 不保证外部非合作 writer 遵守 expected 条件。
- 不把多个 assistant sidecars变成跨文件事务。

## 7. 实施计划

- 先完成 Conversation Inspect/Fingerprint 的规范化 read model。
- 为 `append-user` 增加 expected-next-index。
- 在 completion 的模型请求前后增加 output mutation guard。
- 与 Completion Receipt 集成 conflict 状态。
- 增加两个进程竞争、模型请求期间 mutation 和 layered output 测试。
- 更新 Conversation Protocol 的并发章节。

## 8. 验收标准

- expected 条件不匹配时不写 Conversation artifact。
- 两个竞争 writer 使用相同 expected-next-index 时最多一个成功。
- 模型请求期间目录变化能在 continue 写入前被检测。
- 单目录和 layered output directory 使用一致的本地 next idx 规则。
- 未提供 expected 条件时保持现有兼容行为。

## 9. 待定项

- 冲突使用哪个稳定退出码。
- 模型已经产生费用但 continue conflict 时，是否仍允许写 `-o` 和 receipt。
- Fingerprint 读取成本和大型 Conversation 的缓存策略。
- 是否允许 expected condition 从文件读取，避免长 hash 出现在进程 argv。
