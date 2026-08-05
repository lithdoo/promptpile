# 编排系统

> 层级：10 · Architecture  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：多阶段/多轮 orchestration 与 Promptpile execution 的关系  
> 最近复核：2026-08-05

```text
Orchestrator
  ├─ 选择 phase / profile / prompt / tool policy
  ├─ spawn promptpile public CLI
  ├─ 读取输出 artifacts
  └─ 决定下一阶段
```

Orchestrator 不重新实现 Promptpile 的 profile parser、conversation scanner 或私有文件 handler。

## React 当前实现

```text
Thought → Observe → Check ── continue=true ──► next round
                    │
                    └── continue=false ─────► Final
```

- Thought：可带 tools，注入 core system sidecar。
- Observe：`--disable-tool`，扫描完整 conversation，输出纯文本观察。
- Check：空临时目录 + insert-files + 临时 decision tool，只根据 observation 决策。
- Final：`--disable-tool`，可选 final prompt。

React 只知道 profile 名称与显式 phase override；`[[llm_api]]` 内容由 Promptpile 解析。

`promptpile-plan` 当前只定义未来 Plan → Exec 方向，仍是 scaffold。
