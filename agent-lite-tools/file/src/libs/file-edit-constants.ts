/** Claude `Edit` tool name. */
export const FILE_EDIT_TOOL_NAME = 'Edit'

export const FILE_EDIT_SAME_STRING_ERROR =
  'No changes to make: old_string and new_string are exactly the same.'

export const FILE_EDIT_NOTEBOOK_ERROR =
  'File is a Jupyter Notebook. Use the dedicated notebook edit tool to edit this file.'

export const FILE_DOES_NOT_EXIST_ERROR = 'File does not exist.'

export const FILE_EDIT_CREATE_EXISTS_ERROR =
  'Cannot create new file - file already exists.'

export function fileEditAmbiguousError(matches: number, oldString: string): string {
  return `Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more context to uniquely identify the instance.\nString: ${oldString}`
}

export const FILE_EDIT_STRING_NOT_IN_FILE = 'String not found in file. Failed to apply edit.'
