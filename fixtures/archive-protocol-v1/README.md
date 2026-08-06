# Archive Protocol v1 conformance corpus

该目录是 Archive Protocol v1 的共享、只读测试语料。Producer、restore implementation 与独立 consumer 应直接使用这些 cases，不要在各 package 内复制一份稍有差异的 fixture。

`cases.json` 分别声明 read-only consumer 与 restore 对每个 conversation directory 的预期行为：

- consumer 只发现 `[N]system.md.archive/`，验证 v1 最小 manifest，并忽略 staging、summary 是否存在及未知 metadata；
- restore 对合法 archive 可执行只读 preflight，对无效或有歧义的状态在 mutation 前失败；
- fixture 本身在所有 conformance test 前后必须 byte-for-byte 不变。

添加或修改 v1 行为时，应先更新 Archive Protocol 文档，再更新本 corpus 和所有使用方测试。
