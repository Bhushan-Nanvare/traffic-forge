@echo off
REM ============================================================
REM  TrafficForge AI - Production build + single-port launcher
REM  Builds frontend + backend, then runs ONE server on :8080
REM  that serves the React build as static files.
REM ============================================================

setlocal enableextensions enabledelayedexpansion
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

if not exist ".env" (
  echo [ERROR] No .env file in project root. Cannot start.
  pause
  exit /b 1
)

REM --- Load .env into current cmd session (skips # comments) ---
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  set "_k=%%A"
  setlocal enabledelayedexpansion
  if not "!_k!"=="" if not "!_k:~0,1!"=="#" (
    endlocal
    set "%%A=%%B"
  ) else (
    endlocal
  )
)

REM --- DATABASE_URL sanity ------------------------------------
echo !DATABASE_URL! | findstr /R /C:"^postgresql://user:password@localhost:5432" >nul
if !errorlevel! equ 0 (
  echo [BLOCKER] .env has the PLACEHOLDER DATABASE_URL. Replace with a real Postgres URL.
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
call pnpm --filter @workspace/db run push
if errorlevel 1 echo [INFO] DB schema push had non-zero exit (often means already up-to-date)

echo [INFO] Starting production server on http://localhost:8080 ...
REM Pass DATABASE_URL through to the new window so the server sees it.
start "TrafficForge Prod (8080)" cmd /k "set NODE_ENV=production&&set PORT=8080&&set DATABASE_URL=!DATABASE_URL!&&set GROQ_API_KEY=!GROQ_API_KEY!&&set GROQ_MODEL=!GROQ_MODEL!&&set LLM_PROVIDER=!LLM_PROVIDER!&&set LLM_FALLBACK=!LLM_FALLBACK!&&pnpm --filter @workspace/api-server run start"

timeout /t 6 /nobreak >nul
start "" "http://localhost:8080"

echo.
echo ============================================================
echo  Production server is running on http://localhost:8080
echo  Close the server window to stop it (or run stop.bat).
echo ============================================================
pause
endlocal
