@echo off
REM Starts the Porta app (proxy on 127.0.0.1:3170 + web on 127.0.0.1:3070) in the
REM foreground, so this process owns the app's lifetime. The repo root is resolved
REM two levels up from this script (deploy\windows\ -> repo root), so it works from
REM any checkout location without hard-coded paths.
setlocal
pushd "%~dp0..\.."
REM pnpm is expected on PATH via corepack (see install-watchdog.ps1). Never let corepack
REM block on its interactive download prompt when we are running hidden.
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
if not exist "logs" mkdir "logs"
echo [%date% %time%] Starting Porta (proxy + web)...>> "logs\porta.log"
REM "< NUL" hands stdin an immediate EOF, so nothing can ever hang waiting for input.
call pnpm.cmd dev < NUL >> "logs\porta.log" 2>&1
echo [%date% %time%] Porta process exited with code %errorlevel%.>> "logs\porta.log"
popd
endlocal
