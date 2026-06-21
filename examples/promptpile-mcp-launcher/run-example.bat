@echo off
setlocal
cd /d "%~dp0"

REM MCP stdio passes PATH from Node to child processes. Merge registry Path so uvx is found.
REM Do not use ASCII parentheses inside REM lines; they break cmd.exe parsing.
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')"`) do set "PATH_MACHINE=%%a"
for /f "usebackq delims=" %%b in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH_USER=%%b"
set "PATH=%PATH_MACHINE%;%PATH_USER%;%PATH%"

if not exist "allowed" mkdir "allowed"

echo Starting promptpile-mcp launch (Ctrl+C to stop)...
call npx --no-install promptpile-mcp launch --config "%~dp0mcp.toml"
exit /b %ERRORLEVEL%
