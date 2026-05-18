@echo off
REM ============================================================
REM  TrafficForge AI — Production build + single-port launcher
REM  Builds frontend + backend, then runs ONE server on :8080
REM  that serves the React build as static files.
REM ============================================================

setlocal enableextensions
cd /d "%~dp0"

echo.
echo === TrafficForge AI - Production mode (single port) ===
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pnpm not on PATH. Install from https://pnpm.io
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call pnpm install
  if errorlevel 1 ( pause & exit /b 1 )
)

echo [INFO] Building everything...
call pnpm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo [INFO] Pushing DB schema...
call pnpm --filter @workspace/db run db:push 2>nul

echo [INFO] Starting production server on http://localhost:8080 ...
start "TrafficForge Prod (8080)" cmd /k "set NODE_ENV=production && set PORT=8080 && pnpm --filter @workspace/api-server run start"

timeout /t 5 /nobreak >nul
start "" "http://localhost:8080"

echo.
echo ============================================================
echo  Production server is running on http://localhost:8080
echo  Close the server window to stop it.
echo ============================================================
pause
endlocal
