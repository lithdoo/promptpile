"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rgAvailable = rgAvailable;
const child_process_1 = require("child_process");
const util_1 = require("util");
const index_js_1 = require("../dist/index.js");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * True when `@vscode/ripgrep` is installed and `rg --version` succeeds for the bundled binary.
 */
async function rgAvailable() {
    try {
        const p = (0, index_js_1.getRgPath)();
        await execFileAsync(p, ['--version'], { timeout: 15000, windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
