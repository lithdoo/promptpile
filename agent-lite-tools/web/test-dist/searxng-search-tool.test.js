"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
    if (!addr || typeof addr === 'string')
        throw new Error('failed to bind test server');
    return {
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise(resolve => server.close(() => resolve())),
    };
}
(0, node_test_1.default)('searxngSearchTool: returns parsed results', async () => {
    const server = await withServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        strict_1.default.equal(url.pathname, '/search');
        strict_1.default.equal(url.searchParams.get('format'), 'json');
        strict_1.default.equal(url.searchParams.get('q'), 'cursor');
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
            results: [
                {
                    title: 'Cursor docs',
                    url: 'https://example.com/cursor',
                    content: 'snippet',
                    engine: 'duckduckgo',
                },
            ],
            suggestions: ['cursor ide'],
        }));
    });
    const tools = (0, index_js_1.createWebTools)({
        searxngConfig: {
            baseUrl: server.url,
            searchPath: '/search',
        },
    });
    const out = await tools.searxngSearchTool.execute({ query: 'cursor', limit: 5 }, {});
    strict_1.default.equal(out.query, 'cursor');
    strict_1.default.equal(out.results.length, 1);
    strict_1.default.equal(out.results[0]?.title, 'Cursor docs');
    strict_1.default.equal(out.summaryApplied, false);
    await tools.dispose();
    await server.close();
});
(0, node_test_1.default)('createWebTools.setWebConfigFile loads both ai and searxng settings', async () => {
    const server = await withServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ results: [] }));
    });
    const fs = await Promise.resolve().then(() => __importStar(require('node:fs/promises')));
    const os = await Promise.resolve().then(() => __importStar(require('node:os')));
    const path = await Promise.resolve().then(() => __importStar(require('node:path')));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcfg-'));
    const file = path.join(dir, '.web.env');
    await fs.writeFile(file, [
        `SEARXNG_BASE_URL=${server.url}`,
        'SEARXNG_SEARCH_PATH=/search',
        'AI_MODEL=gpt-4o-mini',
        'AI_API_KEY=sk-test',
        'AI_API_BASE_URL=http://127.0.0.1:1/v1',
    ].join('\n'), 'utf8');
    const tools = (0, index_js_1.createWebTools)();
    await tools.setWebConfigFile(file);
    strict_1.default.equal(tools.isSearxngEnabled(), true);
    strict_1.default.equal(tools.isAiSummaryEnabled(), true);
    const out = await tools.searxngSearchTool.execute({ query: 'x', summaryPrompt: '总结' }, {});
    strict_1.default.equal(out.summaryApplied, false);
    strict_1.default.ok(out.summaryError);
    await tools.dispose();
    await fs.rm(dir, { recursive: true, force: true });
    await server.close();
});
