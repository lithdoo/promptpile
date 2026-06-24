"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const index_js_1 = require("../dist/index.js");
(0, node_test_1.test)('buildGrepArgs includes pattern and VCS exclusions', () => {
    const args = (0, index_js_1.buildGrepArgs)({ pattern: 'foo' });
    (0, node_assert_1.default)(args.includes('foo'));
    (0, node_assert_1.default)(args.includes('--hidden'));
    (0, node_assert_1.default)(args.join('\n').includes('!.git'));
});
(0, node_test_1.test)('buildGrepArgs uses -e for pattern starting with dash', () => {
    const args = (0, index_js_1.buildGrepArgs)({ pattern: '-foo' });
    node_assert_1.default.deepStrictEqual(args.slice(-2), ['-e', '-foo']);
});
(0, node_test_1.test)('buildGrepArgs maps output_mode to rg flags', () => {
    (0, node_assert_1.default)((0, index_js_1.buildGrepArgs)({ pattern: 'x', output_mode: 'files_with_matches' }).includes('-l'));
    (0, node_assert_1.default)((0, index_js_1.buildGrepArgs)({ pattern: 'x', output_mode: 'count' }).includes('-c'));
    (0, node_assert_1.default)(!(0, index_js_1.buildGrepArgs)({ pattern: 'x', output_mode: 'content' }).includes('-l'));
});
(0, node_test_1.test)('buildGrepArgs adds ignore globs', () => {
    const args = (0, index_js_1.buildGrepArgs)({
        pattern: 'a',
        ignoreGlobs: ['**/node_modules/**'],
    });
    (0, node_assert_1.default)(args.includes('!**/node_modules/**'));
});
