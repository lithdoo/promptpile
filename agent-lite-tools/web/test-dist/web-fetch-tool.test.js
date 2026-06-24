"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = __importDefault(require("node:http"));
const index_js_1 = require("../dist/index.js");
async function withServer(handler) {
    const server = node_http_1.default.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
        throw new Error('Failed to start test server');
    }
    return {
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise(resolve => server.close(() => resolve())),
    };
}
(0, node_test_1.default)('webFetchTool: input schema requires url and prompt', async () => {
    const tools = (0, index_js_1.createWebTools)();
    const schema = tools.webFetchTool.inputSchema;
    strict_1.default.deepEqual(schema.required, ['url', 'prompt']);
    await tools.dispose();
});
(0, node_test_1.default)('webFetchTool: fetches html and returns markdown-like content', async () => {
    const server = await withServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end('<h1>Hello</h1><p>World</p>');
    });
    const tools = (0, index_js_1.createWebTools)();
    const out = await tools.webFetchTool.execute({ url: `${server.url}/page`, prompt: '总结' }, {});
    strict_1.default.equal(out.code, 200);
    strict_1.default.equal(out.summaryApplied, false);
    strict_1.default.match(out.content, /Hello/);
    strict_1.default.match(out.content, /World/);
    await tools.dispose();
    await server.close();
});
(0, node_test_1.default)('webFetchTool: binary content persisted to tmp path', async () => {
    const server = await withServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/pdf');
        res.end(Buffer.from('%PDF-sample-binary', 'utf8'));
    });
    const tools = (0, index_js_1.createWebTools)();
    const out = await tools.webFetchTool.execute({ url: `${server.url}/binary`, prompt: '提取要点' }, {});
    strict_1.default.equal(out.code, 200);
    strict_1.default.ok(out.persistedPath);
    strict_1.default.equal(out.summaryApplied, false);
    await tools.dispose();
    await server.close();
});
(0, node_test_1.default)('webFetchTool: summary enabled but failure degrades gracefully', async () => {
    const server = await withServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('plain text body');
    });
    const tools = (0, index_js_1.createWebTools)({
        aiConfig: {
            model: 'gpt-4o-mini',
            apiKey: 'sk-test',
            apiBaseUrl: 'http://127.0.0.1:1/v1',
        },
    });
    const out = await tools.webFetchTool.execute({ url: `${server.url}/text`, prompt: '一句话总结' }, {});
    strict_1.default.equal(out.summaryApplied, false);
    strict_1.default.ok(out.summaryError);
    strict_1.default.match(out.content, /plain text body/);
    await tools.dispose();
    await server.close();
});
