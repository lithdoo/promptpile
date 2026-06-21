@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if not defined DEEPSEEK_API_KEY (
  echo [ERROR] Set DEEPSEEK_API_KEY in User or System environment.
  echo If you used setx, open a NEW terminal ^(setx does not update the current session^).
  exit /b 1
)

REM MCP gateway port — keep in sync with example/promptpile-mcp-launcher/mcp.toml [gateway].port
set "MCP_PORT=8765"
set "MCP_BASE_URL=http://127.0.0.1:%MCP_PORT%"
set "PROMPTPILE_MCP_BASE_URL=%MCP_BASE_URL%"

REM LLM dump: *.req.json / *.res.json in this directory (thought/observe/check/final tags).
REM Set to 1 to enable request/response dumps.
set "PROMPTPILE_REACT_DEBUG=0"

REM --- Step 1: gateway ready or start launcher ---
curl -sf "%MCP_BASE_URL%/health" >nul 2>&1
if not errorlevel 1 goto step2_setup

echo MCP gateway not reachable at %MCP_BASE_URL%.
netstat -an | findstr ":%MCP_PORT%" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo WARNING: Port %MCP_PORT% is listening but /health failed - another process may own it.
)

echo Starting promptpile-mcp-launcher in a new window...
start "promptpile-mcp-launcher" /D "%~dp0..\promptpile-mcp-launcher" cmd /k call run-example.bat

set WAIT_COUNT=0
:poll_launch
curl -sf "%MCP_BASE_URL%/health" >nul 2>&1
if not errorlevel 1 goto step2_setup
set /a WAIT_COUNT+=1
if !WAIT_COUNT! GEQ 31 (
  echo ERROR: Gateway did not become healthy within ~62s. Check the launcher window.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto poll_launch

:step2_setup
echo MCP gateway OK: %MCP_BASE_URL%

if not exist "messages" mkdir "messages"

if not exist "messages\[0]system.md" (
  > "messages\[0]system.md" echo You are a helpful assistant. Reply in Chinese.
)

set "TOKEN_ARG="
if not "%PROMPTPILE_MCP_TOKEN%"=="" set "TOKEN_ARG=--token %PROMPTPILE_MCP_TOKEN%"

echo Exporting messages\.tools.toml ...
call npx --no-install promptpile-mcp export-tools --base-url "%MCP_BASE_URL%" -o "messages\.tools.toml" %TOKEN_ARG%
if errorlevel 1 (
  echo export-tools failed.
  exit /b 1
)

REM --- Step 3: promptpile-react (config: promptpile-react.toml) ---
echo.
echo LLM debug setting: PROMPTPILE_REACT_DEBUG=%PROMPTPILE_REACT_DEBUG%
echo Starting promptpile-react ^(config: promptpile-react.toml^). User input: type message then Ctrl+Z Enter ^(Windows^) to submit each round. Ctrl+C to exit.
echo.

call npx --no-install promptpile-react --config promptpile-react.toml
set "ERR=!ERRORLEVEL!"

echo.
echo After-hook attempts exec-calls when Thought emits tool_calls ^(gateway must stay up^). Manual retry:
echo   npx --no-install promptpile-mcp exec-calls --base-url "%MCP_BASE_URL%" --dir "%CD%\messages" %TOKEN_ARG%

exit /b !ERR!
