@echo off
REM Runs the Cloudflare tunnel that serves your public hostname.
REM The tunnel id and ingress rules (hostname -> http://127.0.0.1:3000) live in the
REM cloudflared config file, so we run by --config rather than by tunnel name. Running
REM by name is fragile: the name in the config can differ from any name you type here.
setlocal
if "%CLOUDFLARED_EXE%"==""    set "CLOUDFLARED_EXE=cloudflared"
if "%CLOUDFLARED_CONFIG%"=="" set "CLOUDFLARED_CONFIG=%USERPROFILE%\.cloudflared\config.yml"
set "LOG=%USERPROFILE%\.cloudflared\tunnel.log"
echo [%date% %time%] Starting Cloudflare tunnel...>> "%LOG%"
"%CLOUDFLARED_EXE%" tunnel --config "%CLOUDFLARED_CONFIG%" run >> "%LOG%" 2>&1
echo [%date% %time%] Tunnel process exited with code %errorlevel%.>> "%LOG%"
endlocal
