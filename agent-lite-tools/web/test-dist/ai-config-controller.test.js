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
(0, node_test_1.default)('ai config controller: manual and file config merge', async () => {
    const dir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'ai-config-'));
    const envFile = (0, node_path_1.join)(dir, '.ai.env');
    await (0, promises_1.writeFile)(envFile, 'AI_MODEL=file-model\nAI_API_KEY=file-key\nAI_API_BASE_URL=https://file/v1\n', 'utf8');
    const controller = (0, index_js_1.createAiConfigController)({
        model: 'manual-model',
    });
    await controller.setAiConfigFile(envFile);
    const merged = controller.getAiConfig();
    strict_1.default.equal(merged.model, 'manual-model');
    strict_1.default.equal(merged.apiKey, 'file-key');
    strict_1.default.equal(merged.apiBaseUrl, 'https://file/v1');
    strict_1.default.equal(controller.isAiSummaryEnabled(), true);
    await controller.dispose();
    await (0, promises_1.rm)(dir, { recursive: true, force: true });
});
