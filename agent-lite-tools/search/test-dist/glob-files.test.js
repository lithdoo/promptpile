"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
const node_test_1 = require("node:test");
const index_js_1 = require("../dist/index.js");
const rg_skip_1 = require("./rg-skip");
(0, node_test_1.test)('extractGlobBaseDirectory splits static prefix', () => {
    const r = (0, index_js_1.extractGlobBaseDirectory)('src/**/*.ts');
    node_assert_1.default.strictEqual(r.baseDir, 'src');
    node_assert_1.default.strictEqual(r.relativePattern, '**/*.ts');
});
(0, node_test_1.test)('globFiles lists ts files', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'glob-lite-'));
    await (0, promises_1.mkdir)((0, path_1.join)(root, 'a'), { recursive: true });
    await (0, promises_1.writeFile)((0, path_1.join)(root, 'a', 'x.ts'), '//x\n', 'utf8');
    await (0, promises_1.writeFile)((0, path_1.join)(root, 'b.js'), '//b\n', 'utf8');
    const { files, truncated } = await (0, index_js_1.globFiles)('**/*.ts', root, {
        limit: 100,
        offset: 0,
        signal: AbortSignal.timeout(30000),
    });
    node_assert_1.default.strictEqual(truncated, false);
    node_assert_1.default.ok(files.some(f => f.replace(/\\/g, '/').endsWith('a/x.ts')));
    node_assert_1.default.ok(!files.some(f => f.replace(/\\/g, '/').endsWith('b.js')));
});
