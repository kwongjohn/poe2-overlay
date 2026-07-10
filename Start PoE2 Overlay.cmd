@echo off
rem PoE2 Overlay launcher — double-click to run. (Proper installed .exe comes in Phase 6.)
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)

if not exist app\dist (
  echo First run: building the tracker UI...
  pushd app
  call npm install --no-audit --no-fund || (pause & exit /b 1)
  call npm run build || (pause & exit /b 1)
  popd
)

echo Building...
call npx tsc || (pause & exit /b 1)

echo Starting overlay (watches for the Path of Exile 2 window)...
start "" ".\node_modules\.bin\electron.cmd" .
exit /b 0
