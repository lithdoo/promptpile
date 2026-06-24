"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grepTool = void 0;
const path_1 = require("path");
const promises_1 = require("fs/promises");
const build_grep_args_1 = require("../libs/build-grep-args");
const run_ripgrep_1 = require("../libs/run-ripgrep");
const apply_head_limit_1 = require("../libs/apply-head-limit");
const to_relative_path_1 = require("../libs/to-relative-path");
function getDescription() {
    return `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command. The Grep tool uses ripgrep with a stable interface.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use the Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns, use multiline: true
`;
}
const PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pattern: {
            type: 'string',
            description: 'The regular expression pattern to search for in file contents',
        },
        path: {
            type: 'string',
            description: 'File or directory to search in (rg PATH). Defaults to current working directory.',
        },
        glob: {
            type: 'string',
            description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
        },
        output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description: 'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
        },
        '-B': { type: 'number', description: 'Lines before each match (rg -B). Requires output_mode: "content".' },
        '-A': { type: 'number', description: 'Lines after each match (rg -A). Requires output_mode: "content".' },
        '-C': { type: 'number', description: 'Alias for context.' },
        context: {
            type: 'number',
            description: 'Lines before and after each match (rg -C). Requires output_mode: "content".',
        },
        '-n': {
            type: 'boolean',
            description: 'Show line numbers in output (rg -n). Requires output_mode: "content". Defaults to true.',
        },
        '-i': { type: 'boolean', description: 'Case insensitive search (rg -i)' },
        type: {
            type: 'string',
            description: 'File type to search (rg --type). Common types: js, py, rust, go, java, etc.',
        },
        head_limit: {
            type: 'number',
            description: 'Limit output to first N lines/entries. Defaults to 250 when unspecified. Pass 0 for unlimited.',
        },
        offset: {
            type: 'number',
            description: 'Skip first N lines/entries before applying head_limit. Defaults to 0.',
        },
        multiline: {
            type: 'boolean',
            description: 'Enable multiline mode (rg -U --multiline-dotall). Default: false.',
        },
    },
    required: ['pattern'],
};
function expectRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Tool args must be a JSON object');
    }
    return value;
}
function getOptionalNumber(o, key) {
    if (!(key in o) || o[key] === undefined || o[key] === null) {
        return undefined;
    }
    const v = o[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
        return v;
    }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) {
            return n;
        }
    }
    throw new Error(`Invalid number property: ${key}`);
}
function getOptionalBool(o, key) {
    if (!(key in o) || o[key] === undefined || o[key] === null) {
        return undefined;
    }
    const v = o[key];
    if (typeof v === 'boolean') {
        return v;
    }
    if (v === 'true') {
        return true;
    }
    if (v === 'false') {
        return false;
    }
    throw new Error(`Invalid boolean property: ${key}`);
}
function isUncPath(p) {
    return p.startsWith('\\\\') || p.startsWith('//');
}
function truncateUtf8Bytes(s, maxBytes) {
    let out = '';
    let bytes = 0;
    for (const ch of s) {
        const b = Buffer.byteLength(ch, 'utf8');
        if (bytes + b > maxBytes) {
            return { text: out, truncated: true };
        }
        out += ch;
        bytes += b;
    }
    return { text: s, truncated: false };
}
/** Match `path:line:rest` where `path` may contain colons (e.g. Windows `C:\\...`). */
function toContentLineRelativeFile(line, rgRoot, cwdForRelative) {
    const withLineNo = line.match(/:(\d+):(.*)$/);
    if (withLineNo && withLineNo.index !== undefined && withLineNo.index >= 1) {
        const filePath = line.slice(0, withLineNo.index);
        const rest = line.slice(withLineNo.index);
        const absFile = (0, path_1.isAbsolute)(filePath) ? filePath : (0, path_1.join)(rgRoot, filePath);
        return (0, to_relative_path_1.toRelativePath)(absFile, cwdForRelative) + rest;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
        return line;
    }
    const filePath = line.slice(0, colonIndex);
    const rest = line.slice(colonIndex);
    const absFile = (0, path_1.isAbsolute)(filePath) ? filePath : (0, path_1.join)(rgRoot, filePath);
    return (0, to_relative_path_1.toRelativePath)(absFile, cwdForRelative) + rest;
}
exports.grepTool = {
    name: 'Grep',
    description: getDescription(),
    parameters: PARAMETERS,
    async execute(args, options) {
        const o = expectRecord(args);
        const pattern = typeof o.pattern === 'string' ? o.pattern : '';
        if (!pattern) {
            throw new Error('Missing pattern');
        }
        const pathRaw = typeof o.path === 'string' ? o.path : undefined;
        const cwdBase = options?.cwd ?? process.cwd();
        const absolutePath = pathRaw ? (0, path_1.resolve)(cwdBase, pathRaw) : cwdBase;
        if (pathRaw && !isUncPath(absolutePath)) {
            await (0, promises_1.stat)(absolutePath).catch(() => {
                throw new Error(`Path does not exist: ${pathRaw}`);
            });
        }
        const output_mode = o.output_mode === 'content' || o.output_mode === 'files_with_matches' || o.output_mode === 'count'
            ? o.output_mode
            : 'files_with_matches';
        const head_limit = getOptionalNumber(o, 'head_limit');
        const offset = getOptionalNumber(o, 'offset') ?? 0;
        const rgArgs = (0, build_grep_args_1.buildGrepArgs)({
            pattern,
            glob: typeof o.glob === 'string' ? o.glob : undefined,
            type: typeof o.type === 'string' ? o.type : undefined,
            output_mode,
            '-B': getOptionalNumber(o, '-B'),
            '-A': getOptionalNumber(o, '-A'),
            '-C': getOptionalNumber(o, '-C'),
            context: getOptionalNumber(o, 'context'),
            '-n': getOptionalBool(o, '-n'),
            '-i': getOptionalBool(o, '-i'),
            multiline: getOptionalBool(o, 'multiline'),
            ignoreGlobs: options?.ignoreGlobs,
        });
        const results = await (0, run_ripgrep_1.runRipgrep)(rgArgs, absolutePath, {
            cwd: absolutePath,
            signal: options?.signal,
            timeoutMs: options?.timeoutMs,
            maxBuffer: options?.maxStdoutBytes,
        });
        const maxBytes = options?.maxStdoutBytes;
        if (output_mode === 'content') {
            const { items: limitedResults, appliedLimit } = (0, apply_head_limit_1.applyHeadLimit)(results, head_limit, offset);
            const finalLines = limitedResults.map(line => toContentLineRelativeFile(line, absolutePath, cwdBase));
            let content = finalLines.join('\n');
            if (maxBytes !== undefined && Buffer.byteLength(content, 'utf8') > maxBytes) {
                const { text, truncated } = truncateUtf8Bytes(content, maxBytes);
                content = text + (truncated ? '\n[stdout truncated by maxStdoutBytes]' : '');
            }
            return {
                mode: 'content',
                numFiles: 0,
                filenames: [],
                content: content || undefined,
                numLines: finalLines.length,
                ...(appliedLimit !== undefined && { appliedLimit }),
                ...(offset > 0 && { appliedOffset: offset }),
            };
        }
        if (output_mode === 'count') {
            const { items: limitedResults, appliedLimit } = (0, apply_head_limit_1.applyHeadLimit)(results, head_limit, offset);
            const finalCountLines = limitedResults.map(line => {
                const colonIndex = line.lastIndexOf(':');
                if (colonIndex > 0) {
                    const filePath = line.slice(0, colonIndex);
                    const count = line.slice(colonIndex);
                    const absFile = (0, path_1.isAbsolute)(filePath) ? filePath : (0, path_1.join)(absolutePath, filePath);
                    return (0, to_relative_path_1.toRelativePath)(absFile, cwdBase) + count;
                }
                return line;
            });
            let totalMatches = 0;
            let fileCount = 0;
            for (const line of finalCountLines) {
                const colonIndex = line.lastIndexOf(':');
                if (colonIndex > 0) {
                    const countStr = line.slice(colonIndex + 1);
                    const count = parseInt(countStr, 10);
                    if (!Number.isNaN(count)) {
                        totalMatches += count;
                        fileCount += 1;
                    }
                }
            }
            let content = finalCountLines.join('\n');
            if (maxBytes !== undefined && Buffer.byteLength(content, 'utf8') > maxBytes) {
                const { text } = truncateUtf8Bytes(content, maxBytes);
                content = text + '\n[stdout truncated by maxStdoutBytes]';
            }
            return {
                mode: 'count',
                numFiles: fileCount,
                filenames: [],
                content,
                numMatches: totalMatches,
                ...(appliedLimit !== undefined && { appliedLimit }),
                ...(offset > 0 && { appliedOffset: offset }),
            };
        }
        const absoluteFiles = results.map(p => (0, path_1.isAbsolute)(p) ? p : (0, path_1.join)(absolutePath, p));
        const stats = await Promise.allSettled(absoluteFiles.map(f => (0, promises_1.stat)(f)));
        const sortedMatches = absoluteFiles
            .map((f, i) => {
            const r = stats[i];
            return [f, r.status === 'fulfilled' ? (r.value.mtimeMs ?? 0) : 0];
        })
            .sort((a, b) => {
            const timeComparison = b[1] - a[1];
            if (timeComparison === 0) {
                return a[0].localeCompare(b[0]);
            }
            return timeComparison;
        })
            .map(([f]) => f);
        const { items: finalMatches, appliedLimit } = (0, apply_head_limit_1.applyHeadLimit)(sortedMatches, head_limit, offset);
        const relativeMatches = finalMatches.map(f => (0, to_relative_path_1.toRelativePath)(f, cwdBase));
        return {
            mode: 'files_with_matches',
            filenames: relativeMatches,
            numFiles: relativeMatches.length,
            ...(appliedLimit !== undefined && { appliedLimit }),
            ...(offset > 0 && { appliedOffset: offset }),
        };
    },
};
