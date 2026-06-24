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
(0, node_test_1.test)('globTool execute', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'glob-tool-'));
    await (0, promises_1.mkdir)((0, path_1.join)(root, 'sub'), { recursive: true });
    await (0, promises_1.writeFile)((0, path_1.join)(root, 'sub', 'z.ts'), '', 'utf8');
    const tools = (0, index_js_1.createSearchTools)();
    const out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root });
    node_assert_1.default.strictEqual(out.truncated, false);
    node_assert_1.default.ok(out.numFiles >= 1);
    node_assert_1.default.ok(out.filenames.some(f => f.replace(/\\/g, '/').includes('sub/z.ts')));
});
