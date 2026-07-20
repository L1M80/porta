# Always-on Porta over a Cloudflare tunnel (Windows)

This directory is an optional **self-hosting recipe** for keeping a Porta instance reachable
at a public hostname 24/7 on a Windows machine, with a watchdog
that restarts it automatically if either half dies.

It exists because this exact setup went down in a way that was hard to diagnose: the site
returned a Cloudflare **502 Bad Gateway**, and a home-grown watchdog *detected* the outage but
every restart attempt failed, spraying `Windows cannot find 'pnpm'` dialogs across the desktop.
The scripts here encode the fixes so the failure can't recur and the whole thing is reproducible
from a clean checkout.

## ⚠️ Security — this exposes your machine to the internet

A Porta instance can read local files and talk to a local agent. **Exposing it publicly with
no authentication means anyone who learns the hostname can do the same.** Use both layers below:

1. **Application access gate (required, in-repo).** Set these in `.env` before you expose anything:

   ```
   PORTA_REQUIRE_AUTH=1
   PORTA_ACCESS_TOKEN=<a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`>
   ```

   Every request — page, `/api`, and WebSocket — is then rejected unless it carries the token.
   Sign in once by visiting `https://<your-host>/?access_token=<TOKEN>`; that sets an HttpOnly
   cookie for all later requests. The gate is **fail-closed**: enabled with no token = deny all.

2. **Cloudflare Access (strongly recommended, edge).** Put a Zero Trust *Self-hosted*
   application in front of the hostname and an *Allow* policy scoped to your email. This blocks
   unauthorized traffic at Cloudflare's edge so it never reaches your machine at all. Porta is
   built for this — it forwards `CF-Access-Client-Id/Secret` service-token headers to the proxy.

## The two halves

```
                     ┌─────────────────────────── this machine ───────────────────────────┐
  Internet ──TLS──►  Cloudflare edge ──tunnel──►  cloudflared ──►  Porta web  :3000  ──►  Porta proxy :3170
  (your host)                                     (run-tunnel)      (run-porta, `pnpm dev`)
```

* **Porta app** — `pnpm dev` runs the proxy (`127.0.0.1:3170`) and web (`127.0.0.1:3000`).
* **Cloudflare tunnel** — `cloudflared` maps the public hostname to `http://127.0.0.1:3000`.
  The hostname → port mapping lives in `%USERPROFILE%\.cloudflared\config.yml` (`ingress:` block),
  which also names the tunnel id, so we always run the tunnel **by `--config`, never by a typed name**.

## Root causes this recipe fixes

| Symptom | Root cause | Fix in these scripts |
|---|---|---|
| `Windows cannot find 'pnpm'` on every restart | `pnpm` was not on `PATH`; `start /b pnpm` resolves via ShellExecute and fails | `install-watchdog.ps1` installs a corepack pnpm shim into a PATH dir; launchers use `pnpm` from PATH |
| Hidden restart hangs forever | corepack's `[Y/n]` download prompt has no console to answer it | prompt disabled (`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`), version pre-activated, and `run-porta.bat` feeds `< NUL` |
| Tunnel restart always failed | it ran `cloudflared tunnel run <name>` with a name that didn't exist | `run-tunnel.bat` runs by `--config`, so the id/ingress come from the config file |
| Watchdog killed a healthy tunnel | it ran `Stop-Process cloudflared -Force` before every restart | `porta-watchdog.ps1` heals each half independently and never force-kills |
| Desktop spammed with modal dialogs | watchdog used `Wscript.Shell.Popup` | watchdog logs silently to `watchdog.log` |
| Duplicate launches while booting | no guard between the 5-min ticks | single-instance lock + per-component cooldown |

## Install

Prerequisites: [Node.js](https://nodejs.org) (includes corepack) and
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
with a tunnel already created and a `config.yml` whose `ingress` points at `http://127.0.0.1:3000`.

```powershell
# from the repo root
pnpm install                       # or: corepack pnpm install
./deploy/windows/install-watchdog.ps1
```

That installs pnpm on PATH, disables the corepack prompt, registers the **PortaWatchdog**
scheduled task (every 5 minutes + at logon), and brings the pipeline up immediately.

To customise the origin port or the hostname used for the health probe, edit the `param()`
defaults in `porta-watchdog.ps1`, or the task arguments after install.

## Files

| File | Role |
|---|---|
| `install-watchdog.ps1` | one-time, no-admin setup: pnpm-on-PATH + scheduled task |
| `porta-watchdog.ps1` | the watchdog; checks port 3000 + `cloudflared`, heals each half, logs to `watchdog.log` |
| `silent-watchdog.vbs` | the scheduled task's entry point — runs the watchdog with no console flash |
| `run-porta.bat` / `run-porta.vbs` | start the Porta app (hidden) |
| `run-tunnel.bat` / `run-tunnel.vbs` | start the Cloudflare tunnel (hidden) |

## Verify / operate

```powershell
# is everything up?
Get-NetTCPConnection -LocalPort 3000 -State Listen ; Get-Process cloudflared
Invoke-WebRequest https://<your-host>/ -UseBasicParsing | Select-Object StatusCode

# watch the watchdog decisions
Get-Content .\deploy\windows\watchdog.log -Tail 20 -Wait

# force a health check now
Start-ScheduledTask -TaskName PortaWatchdog

# stop the recipe
Unregister-ScheduledTask -TaskName PortaWatchdog -Confirm:$false
```

> Note: `watchdog.log`, `logs/`, and `*.log` are git-ignored — these scripts only ever write logs
> outside version control.
