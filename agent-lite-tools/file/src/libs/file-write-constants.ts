/** Thrown or rejected when on-disk file changed after the last read. */
export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'

export const FILE_NOT_READ_YET_ERROR =
  'File has not been read yet. Read it first before writing to it.'

export const FILE_MODIFIED_SINCE_READ_ERROR =
  'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.'
