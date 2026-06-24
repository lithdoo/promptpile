import { structuredPatch } from 'diff'
import { convertLeadingTabsToSpaces } from './convert-leading-tabs'

export const CONTEXT_LINES = 3

const AMPERSAND_TOKEN = '<<:AMPERSAND_TOKEN:>>'
const DOLLAR_TOKEN = '<<:DOLLAR_TOKEN:>>'

function escapeForDiff(s: string): string {
  return s.split('&').join(AMPERSAND_TOKEN).split('$').join(DOLLAR_TOKEN)
}

function unescapeFromDiff(s: string): string {
  return s.split(AMPERSAND_TOKEN).join('&').split(DOLLAR_TOKEN).join('$')
}

export type StructuredPatchHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/**
 * Build structured diff hunks from before/after full file text (Claude `getPatchFromContents`).
 */
export function getPatchFromContents({
  filePath,
  oldContent,
  newContent,
  ignoreWhitespace = false,
  singleHunk = false,
}: {
  filePath: string
  oldContent: string
  newContent: string
  ignoreWhitespace?: boolean
  singleHunk?: boolean
}): StructuredPatchHunk[] {
  const result = structuredPatch(
    filePath,
    filePath,
    escapeForDiff(oldContent),
    escapeForDiff(newContent),
    undefined,
    undefined,
    {
      ignoreWhitespace,
      context: singleHunk ? 100_000 : CONTEXT_LINES,
    },
  )
  if (!result) {
    return []
  }
  return result.hunks.map((h: (typeof result.hunks)[0]) => ({
    ...h,
    lines: h.lines.map((ln: string) => unescapeFromDiff(ln)),
  }))
}

/**
 * For patch display: diff after converting leading tabs to spaces (Claude `getPatchFromContents` path).
 */
export function getPatchFromContentsForDisplay({
  filePath,
  oldContent,
  newContent,
  ignoreWhitespace = false,
  singleHunk = false,
}: {
  filePath: string
  oldContent: string
  newContent: string
  ignoreWhitespace?: boolean
  singleHunk?: boolean
}): StructuredPatchHunk[] {
  return getPatchFromContents({
    filePath,
    oldContent: convertLeadingTabsToSpaces(oldContent),
    newContent: convertLeadingTabsToSpaces(newContent),
    ignoreWhitespace,
    singleHunk,
  })
}
