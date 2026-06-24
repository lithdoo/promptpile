"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RipgrepTimeoutError = void 0;
exports.runRipgrep = runRipgrep;
const child_process_1 = require("child_process");
function stdoutToString(stdout) {
    if (stdout === undefined || stdout === null) {
        return '';
    }
    if (typeof stdout === 'string') {
        return stdout;
    }
    if (Buffer.isBuffer(stdout)) {
        return stdout.toString('utf8');
    }
    return String(stdout);
}
class RipgrepTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RipgrepTimeoutError';
    }
}
exports.RipgrepTimeoutError = RipgrepTimeoutError;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_BUFFER = 20000000;
function splitLines(stdout) {
    const s = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!s) {
        return [];
    }
    const lines = s.split('\n');
    if (lines.length && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}
/**
 * Run `rg` on PATH with given args; last path argument is `searchRoot` (search root), matching Claude's contract.
 * Exit code 0 and 1 are both success (1 = no matches).
 */
function runRipgrep(args, searchRoot, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const fullArgs = [...args, searchRoot];
    if (options.signal?.aborted) {
        return Promise.reject(new Error('Search aborted before start'));
    }
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.execFile)('rg', fullArgs, {
            cwd: searchRoot,
            maxBuffer,
            timeout: timeoutMs,
            signal: options.signal,
            killSignal: process.platform === 'win32' ? undefined : 'SIGKILL',
            windowsHide: true,
        }, (err, stdout) => {
            const outStr = stdoutToString(stdout);
            if (!err) {
                resolve(splitLines(outStr));
                return;
            }
            const ex = err;
            if (ex.code === 1) {
                const s = outStr || stdoutToString(ex.stdout);
                resolve(splitLines(s));
                return;
            }
            if (ex.killed || ex.signal === 'SIGTERM' || ex.signal === 'SIGKILL') {
                reject(new RipgrepTimeoutError(ex.signal
                    ? `ripgrep was killed (${ex.signal})`
                    : 'ripgrep timed out or was killed'));
                return;
            }
            if (ex.code === 'ABORT_ERR' || options.signal?.aborted) {
                reject(new Error('Search aborted'));
                return;
            }
            reject(err);
        });
    });
}
