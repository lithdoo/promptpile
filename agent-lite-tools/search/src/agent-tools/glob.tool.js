"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globTool = void 0;
const path_1 = require("path");
const promises_1 = require("fs/promises");
const glob_files_1 = require("../libs/glob-files");
const to_relative_path_1 = require("../libs/to-relative-path");
const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`;
const PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pattern: {
            type: 'string',
            description: 'The glob pattern to match files against',
        },
        path: {
            type: 'string',
            description: 'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
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
function isUncPath(p) {
    return p.startsWith('\\\\') || p.startsWith('//');
}
exports.globTool = {
    name: 'Glob',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    async execute(args, options) {
        const o = expectRecord(args);
        const pattern = typeof o.pattern === 'string' ? o.pattern : '';
        if (!pattern) {
            throw new Error('Missing pattern');
        }
        const pathRaw = typeof o.path === 'string' ? o.path : undefined;
        const cwdBase = options?.cwd ?? process.cwd();
        const searchDir = pathRaw ? (0, path_1.resolve)(cwdBase, pathRaw) : cwdBase;
        if (pathRaw && !isUncPath(searchDir)) {
            const st = await (0, promises_1.stat)(searchDir).catch(() => null);
            if (!st || !st.isDirectory()) {
                throw new Error(`Path is not a directory or does not exist: ${pathRaw}`);
            }
        }
        const start = Date.now();
        const { files, truncated } = await (0, glob_files_1.globFilesWithExecuteOptions)(pattern, searchDir, glob_files_1.DEFAULT_GLOB_LIMIT, 0, options);
        const filenames = files.map(f => (0, to_relative_path_1.toRelativePath)(f, cwdBase));
        return {
            durationMs: Date.now() - start,
            numFiles: filenames.length,
            filenames,
            truncated,
        };
    },
};
