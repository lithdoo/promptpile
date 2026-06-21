@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM cmd.exe does not auto-load .env; read DEEPSEEK_API_KEY from optional .env in this folder.
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    if not "%%a"=="" (
      if /i "%%a"=="DEEPSEEK_API_KEY" if not "%%b"=="" set "DEEPSEEK_API_KEY=%%b"
    )
  )
)

if not defined DEEPSEEK_API_KEY (
  echo [ERROR] DEEPSEEK_API_KEY is not set.
  echo Set the User or System environment variable DEEPSEEK_API_KEY, OR create ".env" in this folder with:
  echo   DEEPSEEK_API_KEY=sk-...
  echo If you used setx, open a NEW cmd window ^(setx does not update the current session^).
  exit /b 1
)

if not exist "messages" mkdir "messages"
if not exist "messages\[0]system.md" (
  > "messages\[0]system.md" echo You are a helpful assistant. Reply in Chinese.
)

echo Starting promptpile chat loop (DeepSeek, config: promptpile.toml^)...
echo Input ends with Ctrl+Z then Enter.

:loop
echo.
echo ---- New Round ----
call npx --no-install promptpile --config promptpile.toml --input --continue
if errorlevel 1 (
  echo [ERROR] promptpile failed.
  exit /b 1
)

set /p AGAIN=Continue? (Y/N):
if /I "!AGAIN!"=="Y" goto loop

echo Bye.
exit /b 0
