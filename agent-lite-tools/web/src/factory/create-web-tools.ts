import { createWebFetchTool } from '../agent-tools/web-fetch.tool'
import { createSearxngSearchTool } from '../agent-tools/searxng-search.tool'
import {
  createAiConfigController,
  type AiSummaryConfig,
} from './ai-config-controller'
import type { WebFetchToolConfig } from '../agent-tools/types'
import {
  createSearxngConfigController,
  type SearxngConfig,
} from './searxng-config-controller'

export type CreateWebToolsConfig = {
  aiConfig?: AiSummaryConfig
  searxngConfig?: SearxngConfig
  fetch?: WebFetchToolConfig
}

export function createWebTools(config: CreateWebToolsConfig = {}) {
  const aiConfigController = createAiConfigController(config.aiConfig ?? {})
  const searxngConfigController = createSearxngConfigController(
    config.searxngConfig ?? {},
  )

  const setWebConfigFile = async (filePath?: string) => {
    await Promise.all([
      aiConfigController.setAiConfigFile(filePath),
      searxngConfigController.setSearxngConfigFile(filePath),
    ])
  }

  const dispose = async () => {
    await Promise.all([
      aiConfigController.dispose(),
      searxngConfigController.dispose(),
    ])
  }

  return {
    webFetchTool: createWebFetchTool(aiConfigController, config.fetch),
    searxngSearchTool: createSearxngSearchTool(
      searxngConfigController,
      aiConfigController,
    ),
    setAiConfig: aiConfigController.setAiConfig,
    getAiConfig: aiConfigController.getAiConfig,
    setAiConfigFile: aiConfigController.setAiConfigFile,
    getAiConfigSources: aiConfigController.getAiConfigSources,
    isAiSummaryEnabled: aiConfigController.isAiSummaryEnabled,
    setSearxngConfig: searxngConfigController.setSearxngConfig,
    getSearxngConfig: searxngConfigController.getSearxngConfig,
    setSearxngConfigFile: searxngConfigController.setSearxngConfigFile,
    getSearxngConfigSources: searxngConfigController.getSearxngConfigSources,
    isSearxngEnabled: searxngConfigController.isSearxngEnabled,
    setWebConfigFile,
    dispose,
  }
}
