"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GLOB_LIMIT = void 0;
exports.extractGlobBaseDirectory = extractGlobBaseDirectory;
exports.globFiles = globFiles;
exports.globFilesWithExecuteOptions = globFilesWithExecuteOptions;
const path_1 = require("path");
const env_truthy_1 = require("./env-truthy");
const run_ripgrep_1 = require("./run-ripgrep");
exports.DEFAULT_GLOB_LIMIT = 100;
/**
 * Extracts the static base directory from a glob pattern (ported from Claude Code).
 */
function extractGlobBaseDirectory(pattern) {
    const globChars = /[*?[{]/;
    const match = pattern.match(globChars);
    if (!match || match.index === undefined) {
        const dir = (0, path_1.dirname)(pattern);
        const file = (0, path_1.basename)(pattern);
        return { baseDir: dir, relativePattern: file };
    }
    const staticPrefix = pattern.slice(0, match.index);
    const lastSepIndex = Math.max(staticPrefix.lastIndexOf('/'), staticPrefix.lastIndexOf(path_1.sep));
    if (lastSepIndex === -1) {
        return { baseDir: '', relativePattern: pattern };
    }
    let baseDir = staticPrefix.slice(0, lastSepIndex);
    const relativePattern = pattern.slice(lastSepIndex + 1);
    if (baseDir === '' && lastSepIndex === 0) {
        baseDir = '/';
    }
    if (process.platform === 'win32' && /^[A-Za-z]:$/.test(baseDir)) {
        baseDir = baseDir + path_1.sep;
    }
    return { baseDir, relativePattern };
}
async function globFiles(filePattern, cwd, opts) {
    let searchDir = cwd;
    let searchPattern = filePattern;
    if ((0, path_1.isAbsolute)(filePattern)) {
        const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern);
        if (baseDir) {
            searchDir = (0, path_1.isAbsolute)(baseDir) ? baseDir : (0, path_1.join)(cwd, baseDir);
            searchPattern = relativePattern;
        }
    }
    const noIgnore = (0, env_truthy_1.isEnvTruthy)(process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true', true);
    const hidden = (0, env_truthy_1.isEnvTruthy)(process.env.CLAUDE_CODE_GLOB_HIDDEN || 'true', true);
    const args = [
        '--files',
        '--glob',
        searchPattern,
        '--sort=modified',
        ...(noIgnore ? ['--no-ignore'] : []),
        ...(hidden ? ['--hidden'] : []),
    ];
    for (const pattern of opts.ignoreGlobs ?? []) {
        if (pattern) {
            args.push('--glob', `!${pattern}`);
        }
    }
    const lines = await (0, run_ripgrep_1.runRipgrep)(args, searchDir, {
        cwd: searchDir,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        maxBuffer: opts.maxBuffer,
    });
    const absolutePaths = lines.map(p => ((0, path_1.isAbsolute)(p) ? p : (0, path_1.join)(searchDir, p)));
    const truncated = absolutePaths.length > opts.offset + opts.limit;
    const files = absolutePaths.slice(opts.offset, opts.offset + opts.limit);
    return { files, truncated };
}
async function globFilesWithExecuteOptions(filePattern, cwd, limit, offset, exec) {
    const ignoreGlobs = [
        ...(exec?.ignoreGlobs ?? []),
    ];
    return globFiles(filePattern, cwd, {
        limit,
        offset,
        signal: exec?.signal,
        timeoutMs: exec?.timeoutMs,
        maxBuffer: exec?.maxStdoutBytes,
        ignoreGlobs,
    });
}
