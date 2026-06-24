import { createFileEditTool } from '../agent-tools/file-edit.tool'
import { createFileWriteTool } from '../agent-tools/file-write.tool'
import { createReadFileInRangeTool } from '../agent-tools/read-file-in-range.tool'
import { createAccessController } from './access-controller'

export type CreateFileToolsConfig = {
  roots?: string[]
}

export function createFileTools(config: CreateFileToolsConfig = {}) {
  const accessController = createAccessController(config.roots ?? [])

  return {
    readFileTool: createReadFileInRangeTool(accessController),
    writeFileTool: createFileWriteTool(accessController),
    editFileTool: createFileEditTool(accessController),
    setRoots: accessController.setRoots,
    getRoots: accessController.getRoots,
    setRootsFile: accessController.setRootsFile,
    getRootsSources: accessController.getRootsSources,
    dispose: accessController.dispose,
  }
}
