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
(0, node_test_1.test)('grepTool files_with_matches', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'grep-fw-'));
    await (0, promises_1.writeFile)((0, path_1.join)(root, 'a.txt'), 'needle here\n', 'utf8');
    const tools = (0, index_js_1.createSearchTools)();
    const out = await tools.grepTool.execute({ pattern: 'needle', output_mode: 'files_with_matches' }, { cwd: root });
    node_assert_1.default.strictEqual(out.mode, 'files_with_matches');
    node_assert_1.default.ok(out.numFiles >= 1);
    node_assert_1.default.ok(out.filenames.some(f => f.replace(/\\/g, '/').endsWith('a.txt')));
});
(0, node_test_1.test)('grepTool content mode with -i', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'grep-co-'));
    await (0, promises_1.writeFile)((0, path_1.join)(root, 'b.txt'), 'FooBar\n', 'utf8');
    const tools = (0, index_js_1.createSearchTools)();
    const out = await tools.grepTool.execute({ pattern: 'foo', output_mode: 'content', '-i': true, head_limit: 10 }, { cwd: root });
    node_assert_1.default.strictEqual(out.mode, 'content');
    node_assert_1.default.ok((out.content || '').toLowerCase().includes('foobar'));
});
(0, node_test_1.test)('grepTool count mode', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'grep-ct-'));
    await (0, promises_1.writeFile)((0, path_1.join)(root, 'c.txt'), 'x\nx\n', 'utf8');
    const tools = (0, index_js_1.createSearchTools)();
    const out = await tools.grepTool.execute({ pattern: 'x', output_mode: 'count', path: root }, { cwd: root });
    node_assert_1.default.strictEqual(out.mode, 'count');
    node_assert_1.default.ok((out.numMatches ?? 0) >= 1);
});
(0, node_test_1.test)('grepTool pattern starting with dash uses -e', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'grep-dash-'));
    await (0, promises_1.writeFile)((0, path_1.join)(root, 'd.txt'), '-edge\n', 'utf8');
    const tools = (0, index_js_1.createSearchTools)();
    const out = await tools.grepTool.execute({ pattern: '-edge', output_mode: 'files_with_matches' }, { cwd: root });
    node_assert_1.default.ok(out.filenames.length >= 1);
});
