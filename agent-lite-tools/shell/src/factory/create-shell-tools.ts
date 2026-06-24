import { bashTool } from '../agent-tools/bash.tool'
import { powershellTool } from '../agent-tools/powershell.tool'

export type CreateShellToolsConfig = {
  // Reserved for future shared configuration.
}

export function createShellTools(_config: CreateShellToolsConfig = {}) {
  return {
    bashTool,
    powershellTool,
  }
}
