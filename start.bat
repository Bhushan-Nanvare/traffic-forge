@echo off
REM ============================================================
REM  TrafficForge AI - One-click local launcher
REM  Validates env -> installs deps -> runs backend+frontend -> opens browser
REM ============================================================

setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

echo.
echo === TrafficForge AI - Starting local dev environment ===
echo.

REM --- Sanity checks ------------------------------------------
where pnpm >nul 2>nul || (echo [ERROR] pnpm not on PATH. https://pnpm.io/installation & pause & exit /b 1)
where node >nul 2>nul || (echo [ERROR] Node 20+ not on PATH. https://nodejs.org & pause & exit /b 1)

REM --- .env presence ------------------------------------------
if not exist ".env" (
  if exist ".env.example" (
    echo [INFO] No .env found. Creating from .env.example
    copy /Y .env.example .env >nul
  ) else (
    echo [ERROR] No .env or .env.example. Cannot continue.
    pause
    exit /b 1
  )
)

REM --- DATABASE_URL sanity ------------------------------------
REM Reject the placeholder so the user does NOT silently get a broken app.
findstr /R /C:"^DATABASE_URL=postgresql://user:password@localhost:5432" .env >nul
if !errorlevel! equ 0 (
  echo.
  echo ============================================================
  echo  [BLOCKER] Your .env still has the PLACEHOLDER DATABASE_URL.
  echo.
  echo  The backend will boot, but every API call will fail with
  echo  ECONNREFUSED because no Postgres is running there.
  echo.
  echo  Quickest fix - free hosted Postgres in ~2 minutes:
  echo    1. Sign up at https://neon.tech  (no card)
  echo    2. Create a new project
  echo    3. Copy the connection string ^(starts with postgresql://...^)
  echo    4. Paste it into .env, replacing the placeholder line
  echo    5. Re-run this script
  echo.
  echo  Alternative: run a local Postgres in Docker:
  echo    docker run --name tf-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
  echo    Then in .env set: DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres
  echo ============================================================
  echo.
  pause
  exit /b 1
)

REM --- Install dependencies if missing ------------------------
if not exist "node_modules" (
  echo [INFO] First run: installing dependencies (1-2 min)...
  call pnpm install || (echo [ERROR] pnpm install failed & pause & exit /b 1)
)

REM --- Load .env into current cmd session ---------------------
REM drizzle-kit / pnpm subprocesses inherit these env vars.
REM Skips comment lines and empty lines.
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

REM --- Push DB schema (best-effort, fails silently if already up-to-date) ---
echo [INFO] Pushing database schema...
call pnpm --filter @workspace/db run push
if errorlevel 1 echo [INFO] DB schema push had non-zero exit (often means already up-to-date)

REM --- Open browser AFTER dev servers boot, in background -----
start "" cmd /c "timeout /t 8 /nobreak >nul && start \"\" http://localhost:5000"

REM --- Run both servers in parallel via pnpm workspace dev ----
REM This stays in the foreground; Ctrl+C cleanly kills both.
echo.
echo ============================================================
echo  Starting servers (Ctrl+C to stop both):
echo    Frontend: http://localhost:5000   (opening in browser in 8s)
echo    Backend:  http://localhost:8080/api/health
echo ============================================================
echo.
pnpm -r --parallel dev

endlocal
