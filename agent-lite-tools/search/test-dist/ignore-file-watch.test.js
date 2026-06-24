"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_test_1 = require("node:test");
const index_js_1 = require("../dist/index.js");
const rg_skip_1 = require("./rg-skip");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function waitFor(assertion, attempts = 10, delayMs = 120) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            await assertion();
            return;
        }
        catch (err) {
            lastErr = err;
            await sleep(delayMs);
        }
    }
    throw lastErr;
}
(0, node_test_1.test)('setIgnoreRules excludes matches', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'search-ignore-rules-'));
    try {
        await (0, promises_1.mkdir)((0, node_path_1.join)(root, 'dist'), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(root, 'dist', 'a.ts'), 'x\n', 'utf8');
        await (0, promises_1.writeFile)((0, node_path_1.join)(root, 'src.ts'), 'x\n', 'utf8');
        const tools = (0, index_js_1.createSearchTools)();
        tools.setIgnoreRules(['dist/**']);
        const out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root });
        strict_1.default.ok(out.filenames.some(f => f.endsWith('src.ts')));
        strict_1.default.ok(!out.filenames.some(f => f.includes('dist')));
        await tools.dispose();
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('setIgnoreFile watches change/unlink/add and unions with manual rules', async (t) => {
    if (!(await (0, rg_skip_1.rgAvailable)())) {
        t.skip('rg not on PATH');
        return;
    }
    const root = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'search-ignore-file-'));
    const tools = (0, index_js_1.createSearchTools)({ ignoreRules: ['tmp/**'] });
    try {
        await (0, promises_1.mkdir)((0, node_path_1.join)(root, 'gen'), { recursive: true });
        await (0, promises_1.mkdir)((0, node_path_1.join)(root, 'tmp'), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(root, 'gen', 'a.ts'), 'x\n', 'utf8');
        await (0, promises_1.writeFile)((0, node_path_1.join)(root, 'tmp', 'b.ts'), 'x\n', 'utf8');
        await (0, promises_1.writeFile)((0, node_path_1.join)(root, 'keep.ts'), 'x\n', 'utf8');
        const ignoreFile = (0, node_path_1.join)(root, '.search-ignore');
        await (0, promises_1.writeFile)(ignoreFile, 'gen/**\n', 'utf8');
        await tools.setIgnoreFile(ignoreFile);
        let out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root });
        strict_1.default.ok(!out.filenames.some(f => f.includes('gen/')));
        strict_1.default.ok(!out.filenames.some(f => f.includes('tmp/')));
        strict_1.default.ok(out.filenames.some(f => f.endsWith('keep.ts')));
        await (0, promises_1.writeFile)(ignoreFile, '', 'utf8');
        await waitFor(async () => {
            const sources = tools.getIgnoreSources();
            strict_1.default.equal(sources.file.length, 0);
            out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root });
            strict_1.default.ok(!out.filenames.some(f => f.includes('tmp/')));
        });
        await (0, promises_1.rm)(ignoreFile, { force: true });
        await waitFor(async () => {
            const sources = tools.getIgnoreSources();
            strict_1.default.equal(sources.file.length, 0);
            out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root });
            strict_1.default.ok(!out.filenames.some(f => f.includes('tmp/')));
        });
        await (0, promises_1.writeFile)(ignoreFile, 'gen/**\n', 'utf8');
        await waitFor(async () => {
            const sources = tools.getIgnoreSources();
            strict_1.default.ok(sources.file.some(p => p.includes('gen')));
            out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root });
            strict_1.default.ok(!out.filenames.some(f => f.includes('gen/')));
        });
        await tools.dispose();
        await (0, promises_1.writeFile)(ignoreFile, '', 'utf8');
        await sleep(350);
        out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root });
        strict_1.default.ok(!out.filenames.some(f => f.includes('tmp/')));
        strict_1.default.ok(!out.filenames.some(f => f.includes('gen/')));
    }
    finally {
        await tools.dispose();
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
