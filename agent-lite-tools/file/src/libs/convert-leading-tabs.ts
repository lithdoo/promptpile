/** Leading tabs to two spaces per tab (Claude `convertLeadingTabsToSpaces`). */
export function convertLeadingTabsToSpaces(content: string): string {
  if (!content.includes('\t')) {
    return content
  }
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length))
}
