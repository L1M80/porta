@echo off
REM Runs the Cloudflare tunnel that serves your public hostname.
REM The tunnel id and ingress rules (hostname -> http://127.0.0.1:3070) live in the
REM cloudflared config file, so we run by --config rather than by tunnel name. Running
REM by name is fragile: the name in the config can differ from any name you type here.
setlocal
if "%CLOUDFLARED_EXE%"==""    set "CLOUDFLARED_EXE=cloudflared"
if "%CLOUDFLARED_CONFIG%"=="" set "CLOUDFLARED_CONFIG=%USERPROFILE%\.cloudflared\config.yml"
if "%PORTA_TUNNEL_METRICS_PORT%"=="" set "PORTA_TUNNEL_METRICS_PORT=20241"
if "%PORTA_WATCHDOG_STATE_DIR%"=="" (
    set "LOG_DIR=%USERPROFILE%\.cloudflared"
) else (
    set "LOG_DIR=%PORTA_WATCHDOG_STATE_DIR%"
)
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "LOG=%LOG_DIR%\tunnel.log"
echo [%date% %time%] Starting Cloudflare tunnel...>> "%LOG%"
"%CLOUDFLARED_EXE%" --config "%CLOUDFLARED_CONFIG%" tunnel --metrics "127.0.0.1:%PORTA_TUNNEL_METRICS_PORT%" run >> "%LOG%" 2>&1
echo [%date% %time%] Tunnel process exited with code %errorlevel%.>> "%LOG%"
endlocal
