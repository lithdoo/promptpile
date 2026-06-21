import fs from 'fs';

/** 与 `parse-observe-calls.ts`、README 约定一致；check 阶段须调用此工具给出 `decision`。 */
export const CHECK_DECISION_TOOL_NAME = 'react_check_decision';

/**
 * 写入工具 **`.toml`**（`[[tools]]` 扁平条目，与 `promptpile` 工具格式一致）；
 * loader 会再包装为发给 API 的 OpenAI `tools[]` 元素。
 */
export function writeCheckToolsToml(absPath: string): void {
  const body = `[[tools]]
name = ${JSON.stringify(CHECK_DECISION_TOOL_NAME)}
description = ${JSON.stringify(
    'Given only the observe report above, set whether the outer ReAct loop should continue. You must call this once.'
  )}
parameters = { type = "object", properties = { decision = { type = "boolean", description = "true to continue the loop, false to stop" } }, required = ["decision"] }
`;
  fs.writeFileSync(absPath, body, 'utf8');
}
