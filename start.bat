@echo off
echo ==============================================
echo    Starting Traffic Forge Application
echo ==============================================
echo.

:: Load .env file and export all variables
echo Loading environment variables from .env...
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" (
        set "%%A=%%B"
    )
)

echo Environment loaded.
echo.

echo Starting backend and frontend servers...
echo  - Backend API  : http://localhost:8080
echo  - Frontend     : http://localhost:5173
echo.
echo Press Ctrl+C to stop all servers.
echo.

pnpm -r --parallel dev

pause
