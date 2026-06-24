import { createGlobTool } from '../agent-tools/glob.tool'
import { createGrepTool } from '../agent-tools/grep.tool'
import { createIgnoreController } from './ignore-controller'

export type CreateSearchToolsConfig = {
  ignoreRules?: string[]
}

export function createSearchTools(config: CreateSearchToolsConfig = {}) {
  const ignoreController = createIgnoreController(config.ignoreRules ?? [])
  return {
    globTool: createGlobTool(ignoreController),
    grepTool: createGrepTool(ignoreController),
    setIgnoreRules: ignoreController.setIgnoreRules,
    setIgnoreFile: ignoreController.setIgnoreFile,
    getIgnoreRules: ignoreController.getIgnoreRules,
    getIgnoreSources: ignoreController.getIgnoreSources,
    dispose: ignoreController.dispose,
  }
}
