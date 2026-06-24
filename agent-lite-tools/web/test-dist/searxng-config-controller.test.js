"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const index_js_1 = require("../dist/index.js");
(0, node_test_1.default)('searxng config controller: file and manual merge', async () => {
    const dir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'searxng-config-'));
    const envFile = (0, node_path_1.join)(dir, '.web.env');
    await (0, promises_1.writeFile)(envFile, [
        'SEARXNG_BASE_URL=http://127.0.0.1:8080',
        'SEARXNG_DEFAULT_LANGUAGE=zh',
        'SEARXNG_DEFAULT_ENGINES=bing,duckduckgo',
    ].join('\n'), 'utf8');
    const controller = (0, index_js_1.createSearxngConfigController)({
        defaultLanguage: 'en',
    });
    await controller.setSearxngConfigFile(envFile);
    const cfg = controller.getSearxngConfig();
    strict_1.default.equal(cfg.baseUrl, 'http://127.0.0.1:8080');
    strict_1.default.equal(cfg.defaultLanguage, 'en');
    strict_1.default.deepEqual(cfg.defaultEngines, ['bing', 'duckduckgo']);
    strict_1.default.equal(controller.isSearxngEnabled(), true);
    await controller.dispose();
    await (0, promises_1.rm)(dir, { recursive: true, force: true });
});
