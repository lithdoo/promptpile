@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Synced .env from .env.example
)

if "%DEEPSEEK_API_KEY%"=="" (
  echo [ERROR] DEEPSEEK_API_KEY is not set.
  echo Please set user env var first: setx DEEPSEEK_API_KEY "sk-xxxx"
  exit /b 1
)

set "AI_API_KEY=%DEEPSEEK_API_KEY%"

if not exist "..\node_modules" (
  echo Installing dependencies in promptpile\examples...
  pushd ".."
  call npm install
  if errorlevel 1 (
    popd
    echo npm install failed.
    exit /b 1
  )
  popd
)

if not exist "messages\.tools.toml" (
  echo Generating messages\.tools.toml from agent-lite-tools...
  pushd ".."
  call bun "promptpile-tool-test\scripts\generate-tools-toml.ts"
  if errorlevel 1 (
    popd
    echo [ERROR] bun generate-tools-toml.ts failed.
    exit /b 1
  )
  popd
)

echo Starting promptpile tool-test chat loop (DeepSeek + agent-lite tools)...
echo Input ends with Ctrl+Z then Enter.

:loop
echo.
echo ---- New Round ----
call npx --prefix ".." promptpile --config "promptpile.toml" --input --continue --after-hook-path "after-hook.bat"
if errorlevel 1 (
  echo [ERROR] promptpile failed.
  exit /b 1
)

set /p AGAIN=Continue? (Y/N):
if /I "!AGAIN!"=="Y" goto loop

echo Bye.
exit /b 0
