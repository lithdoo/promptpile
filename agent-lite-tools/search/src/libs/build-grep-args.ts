const VCS_DIRECTORIES_TO_EXCLUDE = [
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
] as const

export type GrepArgsInput = {
  pattern: string
  glob?: string
  type?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  '-B'?: number
  '-A'?: number
  '-C'?: number
  context?: number
  '-n'?: boolean
  '-i'?: boolean
  multiline?: boolean
  /** Host-provided negated globs (same as execute options.ignoreGlobs). */
  ignoreGlobs?: string[]
}

/**
 * Build ripgrep argv (without trailing PATH argument).
 */
export function buildGrepArgs(input: GrepArgsInput): string[] {
  const {
    pattern,
    glob,
    type,
    output_mode = 'files_with_matches',
    '-B': context_before,
    '-A': context_after,
    '-C': context_c,
    context,
    '-n': show_line_numbers = true,
    '-i': case_insensitive = false,
    multiline = false,
  } = input

  const args: string[] = ['--hidden']

  for (const dir of VCS_DIRECTORIES_TO_EXCLUDE) {
    args.push('--glob', `!${dir}`)
  }

  args.push('--max-columns', '500')

  if (multiline) {
    args.push('-U', '--multiline-dotall')
  }

  if (case_insensitive) {
    args.push('-i')
  }

  if (output_mode === 'files_with_matches') {
    args.push('-l')
  } else if (output_mode === 'count') {
    args.push('-c')
  }

  if (show_line_numbers && output_mode === 'content') {
    args.push('-n')
  }

  if (output_mode === 'content') {
    if (context !== undefined) {
      args.push('-C', context.toString())
    } else if (context_c !== undefined) {
      args.push('-C', context_c.toString())
    } else {
      if (context_before !== undefined) {
        args.push('-B', context_before.toString())
      }
      if (context_after !== undefined) {
        args.push('-A', context_after.toString())
      }
    }
  }

  if (pattern.startsWith('-')) {
    args.push('-e', pattern)
  } else {
    args.push(pattern)
  }

  if (type) {
    args.push('--type', type)
  }

  if (glob) {
    const globPatterns: string[] = []
    const rawPatterns = glob.split(/\s+/)
    for (const rawPattern of rawPatterns) {
      if (rawPattern.includes('{') && rawPattern.includes('}')) {
        globPatterns.push(rawPattern)
      } else {
        globPatterns.push(...rawPattern.split(',').filter(Boolean))
      }
    }
    for (const globPattern of globPatterns.filter(Boolean)) {
      args.push('--glob', globPattern)
    }
  }

  for (const patternIgnore of input.ignoreGlobs ?? []) {
    if (patternIgnore) {
      args.push('--glob', `!${patternIgnore}`)
    }
  }

  return args
}
