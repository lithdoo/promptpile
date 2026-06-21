@echo off
setlocal
REM promptpile Thought 阶段成功后由 packages/promptpile 调用；子进程 cwd 为消息目录（PROMPTPILE_SCAN_DIRECTORY）。
REM 需与 run-example.bat 注入的 PROMPTPILE_MCP_BASE_URL 及 promptpile 的 buildPromptpileHookEnv 一致。

if "%PROMPTPILE_MCP_BASE_URL%"=="" exit /b 0
if not "%PROMPTPILE_HAS_TOOL_CALLS%"=="1" exit /b 0
if "%PROMPTPILE_SCAN_DIRECTORY%"=="" exit /b 0

set "HOOK_DIR=%~dp0"
set "TOKEN_ARG="
if not "%PROMPTPILE_MCP_TOKEN%"=="" set "TOKEN_ARG=--token %PROMPTPILE_MCP_TOKEN%"

call npx --no-install promptpile-mcp exec-calls --base-url "%PROMPTPILE_MCP_BASE_URL%" --dir "%PROMPTPILE_SCAN_DIRECTORY%" %TOKEN_ARG%
exit /b %ERRORLEVEL%
