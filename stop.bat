@echo off
REM ============================================================
REM  TrafficForge AI - Stop all dev/prod servers
REM  Kills any process listening on ports 5173, 5000, or 8080.
REM ============================================================

echo Stopping TrafficForge servers...

for %%P in (5173 5000 8080) do (
  for /f "tokens=5" %%X in ('netstat -ano ^| findstr ":%%P.*LISTENING"') do (
    echo Killing PID %%X on port %%P
    taskkill /F /PID %%X >nul 2>nul
  )
)

echo Done.
pause
