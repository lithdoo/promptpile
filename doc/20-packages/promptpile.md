# promptpile

> 类型：package  
> 状态：implemented / beta  
> 主要职责：单次 Chat Completions execution primitive  
> 代码入口：`packages/promptpile/src/index.ts`  
> 最近复核：2026-08-05

## 责任

`promptpile` 负责解析 CLI/config、装配 conversation、加载 tools、调用一次兼容 Chat Completions endpoint、流式输出并持久化 assistant/calls artifacts。

它不执行模型工具调用，也不自动发起第二轮 completion。

## Public surface

- binary：`promptpile`
- root completion CLI
- `promptpile conversation append-user`
- `--llm-config` / `--llm-api` / `--api-key-env`
- conversation / tool artifacts

规范分别见 [CLI Contract v1](../15-contracts/cli-contract-v1.md)、[Conversation Protocol v1](../15-contracts/conversation-protocol-v1.md) 和 [Tool Artifacts v1](../15-contracts/tool-artifacts-v1.md)。

## 内部模块

当前源码按职责拆分为 CLI、config resolution、file handler、AI client、tools loader、atomic file、diagnostics、LLM sampling/extra-body、sidecar、output pile、after-hook 等模块。

## 测试

package test 覆盖 config resolution、LLM profile CLI、API-key env、append-user、output、tools extends、LLM dump、sidecar、empty-dir insert、sampling/extra-body、reasoning extra、atomic diagnostics 与 after-hook security。

[查看 package README](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile/README.md)
