# Promptpile Conversation Fingerprint 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：为 Conversation Protocol 可见视图定义确定性 fingerprint，用于乐观并发和变更检测

## 1. 动机

上层在 completion、compression 或工具执行前后需要判断 Conversation 是否被其它 writer 修改。直接比较目录时间戳、文件枚举顺序或平台路径不稳定；读取全部正文后自行 hash 又会造成多套不一致实现。

## 2. CLI 草案

```bash
promptpile conversation inspect -d ./messages --fingerprint --format json
```

也可考虑独立命令：

```bash
promptpile conversation fingerprint -d ./messages
```

优先复用 `inspect`，避免增加过多 domain commands。

## 3. 规范输入

Fingerprint 只覆盖 Conversation Protocol 可见 artifacts：

- 规范化的相对文件名；
- 文件类型和协议排序位置；
- 文件字节长度；
- 文件内容 SHA-256。

不覆盖：

- mtime、ctime、inode；
- 绝对路径；
- 非协议文件；
- lock、临时文件和外部 receipt；
- 平台目录分隔符。

规范记录按 Conversation Protocol 顺序编码，再对整体内容计算 SHA-256。

## 4. 输出草案

```json
{
  "schemaVersion": 1,
  "algorithm": "sha256",
  "artifactCount": 17,
  "maxIndex": 8,
  "fingerprint": "sha256:..."
}
```

Layered 模式下应分别提供每层 fingerprint 和组合 fingerprint；组合 fingerprint 必须包含 layer 顺序，但不包含机器相关绝对路径。

## 5. 一致性限制

Fingerprint 计算不是目录快照事务。读取期间文件变化时必须检测并失败，不能返回可能混合两个时刻的 hash。初步实现可在读取前后比较协议文件的名称、大小和 metadata，并在不一致时重试有限次数或直接失败。

## 6. 使用场景

- completion 前记录 expected fingerprint；
- completion 后判断是否只有预期 artifacts 变化；
- compression planning/commit 冲突检查；
- layered input cache key；
- fixture 确定性验证；
-上层恢复时快速判断 Conversation 是否仍是已知版本。

## 7. 非目标

- 不取代 archive、备份或内容寻址对象库。
- 不提供写锁或多文件事务。
- 不承诺两个相同 fingerprint 的目录拥有相同非协议文件。
- 不把 fingerprint 写入每个 Conversation artifact。

## 8. 实施计划

- 冻结规范编码和 layer 组合算法。
- 在 Conversation Inspect read model 上实现 hashing。
- 增加读期间变化检测。
- 提供 JSON/text 输出。
- 在后续 optimistic concurrency 提案中复用，而不重复算法。
- 增加跨平台 golden fixtures。

## 9. 验收标准

- 相同协议内容在 Windows/POSIX 上产生相同 fingerprint。
- mtime、绝对路径和目录枚举顺序不影响结果。
- 任意协议 artifact 正文或文件名变化都会改变 fingerprint。
- 读取期间发生 mutation 时不会返回伪稳定结果。
- Layer 顺序变化会改变组合 fingerprint。

## 10. 待定项

- 是否包含被 scanner 识别但产生 diagnostic 的文件。
- 是否允许只 hash filename/size 的快速弱 fingerprint；第一版建议只提供强 fingerprint。
- 大型 archive 下的增量缓存策略。
- 组合 fingerprint 是否包含每层可选的调用者 label。
