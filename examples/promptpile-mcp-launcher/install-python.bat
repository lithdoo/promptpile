@echo off
setlocal
cd /d "%~dp0"

python --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
  python --version
  echo Python is already available on PATH. Nothing to do.
  exit /b 0
)

where winget >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo winget is not available. Install Python 3.14 manually from https://www.python.org/downloads/
  echo Or install App Installer from Microsoft Store, then re-run this script.
  exit /b 1
)

echo Python not found. Installing Python 3.14 via winget package Python.Python.3.14 ...
echo This may require administrator approval or an elevated terminal.
winget install --id Python.Python.3.14 -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo winget install failed.
  exit /b 1
)

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')"`) do set "PATH_MACHINE=%%a"
for /f "usebackq delims=" %%b in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH_USER=%%b"
set "PATH=%PATH_MACHINE%;%PATH_USER%;%PATH%"

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
  python --version
  echo Done.
) else (
  echo Python was installed but not found in this session. Close this window and open a new cmd, then run: python --version
)

exit /b 0
