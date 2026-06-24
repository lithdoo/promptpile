import { FILE_EDIT_STRING_NOT_IN_FILE } from './file-edit-constants'
import { applyEditToFile } from './file-edit-text'
import {
  getPatchFromContentsForDisplay,
  type StructuredPatchHunk,
} from './patch-from-contents'

/**
 * One replace pass + display patch (Claude `getPatchForEdit` / `getPatchForEdits` single-edit).
 */
export function getPatchForEdit({
  filePath,
  fileContents,
  oldString,
  newString,
  replaceAll = false,
}: {
  filePath: string
  fileContents: string
  oldString: string
  newString: string
  replaceAll?: boolean
}): { patch: StructuredPatchHunk[]; updatedFile: string } {
  const previousContent = fileContents
  const updatedFile =
    oldString === ''
      ? newString
      : applyEditToFile(
          fileContents,
          oldString,
          newString,
          replaceAll,
        )

  if (updatedFile === previousContent) {
    throw new Error(FILE_EDIT_STRING_NOT_IN_FILE)
  }

  const patch = getPatchFromContentsForDisplay({
    filePath,
    oldContent: fileContents,
    newContent: updatedFile,
  })

  return { patch, updatedFile }
}
