@echo off
setlocal
cd /d "%~dp0"

echo [promptpile] npm run build ...
call npm run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)

if not exist "dist\index.js" (
  echo ERROR: dist\index.js missing after build.
  exit /b 1
)

echo [promptpile] node dist\index.js -d "%~dp0test-messages" --tools-file "%~dp0test-messages\.tools.toml" %*
echo.
node dist\index.js -d "%~dp0test-messages" --tools-file "%~dp0test-messages\.tools.toml" %*
set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE% neq 0 (
  echo Run failed with code %EXITCODE%.
  echo Tip: pass -k YOUR_KEY or use TOML api_key_env -b BASE_URL -m MODEL. Tools require --tools-file, TOML tools_file, or --disable-tool.
)
exit /b %EXITCODE%
