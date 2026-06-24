"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("../dist/index.js");
(0, node_test_1.default)('parseAiEnvLike parses expected keys with comments', () => {
    const parsed = (0, index_js_1.parseAiEnvLike)(`
# comment
AI_MODEL=gpt-4o-mini
AI_API_KEY="sk-123"
AI_API_BASE_URL=https://api.example.com/v1
OTHER=ignored
`);
    strict_1.default.equal(parsed.model, 'gpt-4o-mini');
    strict_1.default.equal(parsed.apiKey, 'sk-123');
    strict_1.default.equal(parsed.apiBaseUrl, 'https://api.example.com/v1');
});
(0, node_test_1.default)('parseWebEnvLike parses searxng and ai keys', () => {
    const parsed = (0, index_js_1.parseWebEnvLike)(`
SEARXNG_BASE_URL=http://127.0.0.1:8080
SEARXNG_DEFAULT_ENGINES=bing,duckduckgo
SEARXNG_DEFAULT_SAFE_SEARCH=1
AI_MODEL=gpt-4o
`);
    strict_1.default.equal(parsed.searxng.baseUrl, 'http://127.0.0.1:8080');
    strict_1.default.deepEqual(parsed.searxng.defaultEngines, ['bing', 'duckduckgo']);
    strict_1.default.equal(parsed.searxng.defaultSafeSearch, 1);
    strict_1.default.equal(parsed.ai.model, 'gpt-4o');
});
