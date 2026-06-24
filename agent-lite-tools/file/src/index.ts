export type {
  AgentToolDefinition,
  FileToolExecuteContext,
  JsonObjectSchema,
} from './agent-tools'
export {
  createFileEditTool,
  createFileWriteTool,
  createReadFileInRangeTool,
} from './agent-tools'
export type { CreateFileToolsConfig } from './factory/create-file-tools'
export { createFileTools } from './factory/create-file-tools'
export {
  ROOT_ACCESS_DENIED_ERROR,
  createAccessController,
  type AccessController,
} from './factory/access-controller'
export {
  FILE_MODIFIED_SINCE_READ_ERROR,
  FILE_NOT_READ_YET_ERROR,
  FILE_UNEXPECTEDLY_MODIFIED_ERROR,
} from './libs/file-write-constants'
export type { FileReadStateEntry, FileReadStateMap } from './libs/file-read-state'
export {
  isFullFileReadState,
  setStateFromFullRead,
  setStateFromReadInRange,
} from './libs/file-read-state'
export { getFileModificationTime } from './libs/get-mtime'
export { expandPathForWrite } from './libs/path-resolve'
export type { EditTextFileInput, EditTextFileResult } from './libs/edit-text-file'
export { editTextFile } from './libs/edit-text-file'
export {
  FILE_DOES_NOT_EXIST_ERROR,
  FILE_EDIT_CREATE_EXISTS_ERROR,
  FILE_EDIT_NOTEBOOK_ERROR,
  FILE_EDIT_SAME_STRING_ERROR,
  FILE_EDIT_TOOL_NAME,
} from './libs/file-edit-constants'
export {
  applyEditToFile,
  findActualString,
  preserveQuoteStyle,
} from './libs/file-edit-text'
export { getPatchForEdit } from './libs/get-patch-for-edit'
export { getPatchFromContents, type StructuredPatchHunk } from './libs/patch-from-contents'
export { convertLeadingTabsToSpaces } from './libs/convert-leading-tabs'
export type { WriteTextFileResult } from './libs/write-file'
export { writeTextFile } from './libs/write-file'
export { writeTextContent } from './libs/write-text-content'
export { formatFileSize } from './libs/format-file-size'
export {
  FileTooLargeError,
  readFileInRange,
  type ReadFileRangeResult,
} from './libs/read-file-in-range'
export {
  detectEncodingForResolvedPath,
  detectLineEndingsForString,
  readFileSync,
  readFileSyncWithMetadata,
  type LineEndingType,
  type ReadFileSyncWithMetadataOptions,
} from './libs/file-read-sync'
export {
  defaultFileReadSyncFs,
  safeResolvePath,
  type FileReadSyncFs,
} from './libs/fs-operations-minimal'
