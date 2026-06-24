"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toRelativePath = toRelativePath;
const path_1 = require("path");
/**
 * Return path relative to cwd when possible; otherwise absolute resolved path.
 */
function toRelativePath(filePath, cwd) {
    const abs = (0, path_1.resolve)(filePath);
    const base = (0, path_1.resolve)(cwd);
    let rel = (0, path_1.relative)(base, abs);
    if (rel.startsWith('..') || rel === '') {
        return abs;
    }
    return rel;
}
