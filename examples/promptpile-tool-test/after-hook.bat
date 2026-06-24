@echo off
setlocal EnableDelayedExpansion

rem after-hook for promptpile-tool-test (chat-loop style):
rem promptpile --continue + tool_calls already wrote messages\[N]assistant.calls.jsonl,
rem so this hook only needs to run generate-tool-results.ts to fill in the matching
rem [N]assistant.result.jsonl. No outputs/ dir, no copy step.

if not "%PROMPTPILE_HAS_TOOL_CALLS%"=="1" exit /b 0

if "%PROMPTPILE_DEBUG%"=="1" (
  echo [after-hook] PROMPTPILE_HAS_TOOL_CALLS=%PROMPTPILE_HAS_TOOL_CALLS% 1>&2
  echo [after-hook] PROMPTPILE_SCAN_DIRECTORY=%PROMPTPILE_SCAN_DIRECTORY% 1>&2
  echo [after-hook] PROMPTPILE_ASSISTANT_CALL_FILE=%PROMPTPILE_ASSISTANT_CALL_FILE% 1>&2
)

pushd "%~dp0\.."
call bun "promptpile-tool-test\scripts\generate-tool-results.ts"
set "RC=%ERRORLEVEL%"
popd

if not "%RC%"=="0" (
  echo [after-hook] generate-tool-results.ts exited with code %RC% 1>&2
)
exit /b %RC%
