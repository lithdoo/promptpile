# promptpile-react

> 类型：package  
> 状态：implemented / beta  
> 主要职责：ReAct-style orchestration  
> 代码入口：`packages/promptpile-react/src/index.ts`  
> 最近复核：2026-08-05

## 边界

React production code 只通过公开 Promptpile CLI、stdin 和 artifacts 集成，不依赖 `promptpile/dist/*`。

默认 binary resolution 读取依赖包 `package.json` 的 `bin.promptpile`，要求其指向 Node-compatible entry script；`PROMPTPILE_BIN` 可覆盖为 wrapper/command。

## Runtime

一轮 `nextStep()`：

```text
Thought → Observe → Check
```

三阶段都成功后 `currentStep += 1`。Check false 进入 `final`，达到上限进入 `max_step`，invocation/解析失败进入 `error`。session 结束后可执行 Final。

## Config ownership

React 解析 `[promptpile-react]` 与少量共享 orchestration defaults，但不解析 `[[llm_api]]` 内容。每个 phase 把 `--llm-config`、profile name 和显式 override 传给 Promptpile。

## Architecture guard

测试递归扫描 production TypeScript source，拒绝 `promptpile/dist/*` 私有边界引用；另有 fake CLI protocol tests 与 React → real Promptpile canonical parser 的错误路径 integration tests。

[查看 package README](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-react/README.md)
