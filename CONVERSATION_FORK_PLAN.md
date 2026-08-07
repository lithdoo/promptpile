# Promptpile Conversation Fork 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：提供不调用模型的 Conversation 分支 domain operation

## 1. 动机

用户可能希望从某个历史点创建实验分支、冻结 fixture 或生成可独立压缩/迁移的 Conversation。手工复制容易包含临时文件、遗漏 sidecar 或截断同一 idx 的 assistant/calls/result 组合。

Layered Conversation I/O 已能实现“只读 base + 新 output”的轻量分支；fork 命令只负责需要独立物理副本的场景。

## 2. CLI 草案

```bash
promptpile conversation fork \
  -d ./messages \
  --to ./branches/experiment-a \
  --through-index 12
```

可选：

```text
--dry-run
--format text|json
--copy-mode copy|hardlink
```

第一版建议只实现 `copy`；hardlink 会引入权限、平台和后续原地写风险。

## 3. 复制语义

- 只复制 Conversation Protocol 可见 artifacts。
- `through-index` 包含该 idx 的所有协议 sidecars。
- 不复制非协议文件、lock、临时文件、receipt 和 debug dump。
- 目标必须不存在或为空目录。
- 源目录保持只读，不改变任何文件。
- 每个目标文件通过临时文件加 rename 发布。
- 完成前目标目录应带 incomplete marker；成功后原子移除 marker。

## 4. 输出报告

JSON 模式返回：

```json
{
  "schemaVersion": 1,
  "source": "./messages",
  "target": "./branches/experiment-a",
  "throughIndex": 12,
  "artifactCount": 27,
  "sourceFingerprint": "sha256:..."
}
```

报告是操作结果，不进入目标 Conversation 消息序列。

## 5. 一致性

- fork 开始前获取源 snapshot/fingerprint。
- 复制完成后重新校验源没有变化；变化则失败并保留带 incomplete marker 的目标供清理。
- 不尝试协调非合作 writer；上层仍应串行操作。
- calls 缺少 result 可以被原样复制，但 inspect report 必须提示，不能自动执行或修复。

## 6. 非目标

- 不合并两个 Conversation。
- 不重写 idx。
- 不复制 Promptpile Archive Protocol 的外部 archive，除非未来另有明确模式。
- 不实现 copy-on-write filesystem。
- 不在 fork 中调用模型、工具或 compression。

## 7. 实施计划

- 依赖 Conversation Inspect/Fingerprint 的稳定 read model。
- 实现 dry-run 和目标前置校验。
- 实现协议文件复制与 incomplete marker。
- 增加 crash injection、源并发变化和损坏 sidecar 测试。
- 更新 Conversation Protocol 中的 domain operation 说明。

## 8. 验收标准

- Fork 不复制非协议文件。
- 截止 idx 不会拆散同 idx sidecars。
- 目标可被普通 Promptpile completion 直接读取。
- 源目录变化时不会把目标报告为完整成功。
- 失败不会修改源目录。

## 9. 待定项

- 是否复制 `.archive` artifacts 和 archive manifest。
- 目标失败后的默认清理还是保留诊断目录。
- 是否支持从 layered Conversation materialize 为单目录；这需要明确 idx 重写，第一版不做。
- 是否应放在独立 `promptpile-conversation` 工具而非 root CLI。
