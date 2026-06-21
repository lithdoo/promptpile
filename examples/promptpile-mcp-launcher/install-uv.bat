@echo off
setlocal
cd /d "%~dp0"

where uv >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo uv is already on PATH:
  uv --version
  where uvx >nul 2>&1
  if %ERRORLEVEL% equ 0 uvx --version
  exit /b 0
)

echo Installing uv ^(provides `uvx`, needed for fetch MCP in mcp.toml^)...
echo Uses PowerShell and downloads https://astral.sh/uv/install.ps1 ^(network required^).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
if errorlevel 1 (
  echo Installation failed.
  exit /b 1
)

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"`) do set "USER_PATH=%%a"
set "PATH=%USER_PATH%;%PATH%"

where uv >nul 2>&1
if errorlevel 1 (
  echo uv was installed but not found in this session. Close this window and open a new cmd, then run: uv --version
  exit /b 0
)

uv --version
where uvx >nul 2>&1
if %ERRORLEVEL% equ 0 uvx --version
echo.
echo Done. If `uv` or `uvx` was not recognized above, restart the terminal so PATH refreshes.
exit /b 0
