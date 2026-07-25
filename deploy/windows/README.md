# Self-healing Porta over a Cloudflare tunnel (Windows)

This directory is an optional **self-hosting recipe** for keeping a Porta instance reachable
at a public hostname on a Windows machine, with a watchdog that restarts it automatically
if either half dies.

The no-admin scheduled task runs as the current user with an **Interactive** logon, so the
watchdog is active only while that user is signed in. It resumes at the next logon. If you need
unattended 24/7 recovery before anyone signs in after a reboot, install Porta as a service or
create a credential-backed task instead; that is outside this recipe.

It exists because this exact setup went down in a way that was hard to diagnose: the site
returned a Cloudflare **502 Bad Gateway**, and a home-grown watchdog *detected* the outage but
every restart attempt failed, spraying `Windows cannot find 'pnpm'` dialogs across the desktop.
The scripts here encode the fixes so the failure can't recur and the whole thing is reproducible
from a clean checkout.

## ⚠️ Security — this exposes your machine to the internet

A Porta instance can read local files and talk to a local agent. **Exposing it publicly with
no authentication means anyone who learns the hostname can do the same.** Use both layers below:

1. **Application access gate (required, in-repo).** Set the exact public hostname, browser
   origin, and access gate in `.env` before you run the installer:

   ```
   PORTA_HOST=127.0.0.1
   PORTA_PORT=3170
   PORTA_WEB_PORT=3070
   PORTA_ALLOWED_HOSTS=porta.example.com
   PORTA_CORS_ORIGINS=https://porta.example.com
   PORTA_REQUIRE_AUTH=1
   PORTA_ACCESS_TOKEN=<a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`>
   ```

   `PORTA_ALLOWED_HOSTS` is a hostname with no scheme or path.
   `PORTA_CORS_ORIGINS` is the full `https://` origin used by the browser and WebSocket client.
   Do not use `PORTA_ALLOWED_HOSTS=*` for a public deployment.

   Every request — page, `/api`, and WebSocket — is then rejected unless it carries the token.
   Sign in once by visiting `https://<your-host>/?access_token=<TOKEN>`; that sets an HttpOnly
   cookie for all later requests. The gate is **fail-closed**: enabled with no token = deny all.
   The managed runner pins these validated values into its process environment, so an inherited
   variable or a higher-priority Vite `.env.local`/mode file cannot disable the gate.

2. **Cloudflare Access (strongly recommended, edge).** Put a Zero Trust *Self-hosted*
   application in front of the hostname and an *Allow* policy scoped to your email. This blocks
   unauthorized traffic at Cloudflare's edge so it never reaches your machine at all. Porta is
   built for this — it forwards `CF-Access-Client-Id/Secret` service-token headers to the proxy.

## The two halves

```
                     ┌─────────────────────────── this machine ───────────────────────────┐
  Internet ──TLS──►  Cloudflare edge ──tunnel──►  cloudflared ──►  Porta web  :3070  ──►  Porta proxy :3170
  (your host)                                     (run-tunnel)      (run-porta, `pnpm dev`)
```

* **Porta app** — `pnpm dev` runs the proxy (`127.0.0.1:3170`) and web (`127.0.0.1:3070`).
* **Cloudflare tunnel** — `cloudflared` maps the public hostname to `http://127.0.0.1:3070`.
  The hostname → port mapping lives in `%USERPROFILE%\.cloudflared\config.yml` (`ingress:` block),
  which also names the tunnel id, so we always run the tunnel **by `--config`, never by a typed name**.

## Root causes this recipe fixes

| Symptom | Root cause | Fix in these scripts |
|---|---|---|
| `Windows cannot find 'pnpm'` on every restart | `pnpm` was not on `PATH`; `start /b pnpm` resolves via ShellExecute and fails | `install-watchdog.ps1` installs a corepack pnpm shim into a PATH dir; launchers use `pnpm` from PATH |
| Hidden restart hangs forever | corepack's `[Y/n]` download prompt has no console to answer it | prompt disabled (`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`), version pre-activated, and `run-porta.bat` feeds `< NUL` |
| Tunnel restart always failed | it ran `cloudflared tunnel run <name>` with a name that didn't exist | `run-tunnel.bat` runs by `--config`, so the id/ingress come from the config file |
| Watchdog killed a healthy or unrelated tunnel | it treated every `cloudflared` process as this deployment | each component is tracked by PID, start time, runner path, and a repo/task-specific id; only an unhealthy matching tree is restarted |
| Desktop spammed with modal dialogs | watchdog used `Wscript.Shell.Popup` | watchdog logs silently to an identity-scoped `watchdog-<id>.log` |
| Duplicate launches while booting | no guard between the 5-min ticks | single-instance lock + per-component cooldown |
| A stopped runner left its children alive | ordinary parent/child processes have no shared lifetime on Windows | each runner places its component tree in a kill-on-close Windows Job Object |

## Install

Prerequisites: [Node.js](https://nodejs.org) (includes corepack) and
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
with a tunnel already created. Its `%USERPROFILE%\.cloudflared\config.yml` must route the same
public hostname to Porta's web port:

```yaml
ingress:
  - hostname: porta.example.com
    service: http://127.0.0.1:3070
  - service: http_status:404
```

```powershell
# from the repo root
Copy-Item .env.example .env
# Edit .env: set the public hostname/origin and required access token shown above.
pnpm install                       # or: corepack pnpm install
./deploy/windows/install-watchdog.ps1 -PublicHost porta.example.com
```

The installer validates the public host against `PORTA_ALLOWED_HOSTS` and
`PORTA_CORS_ORIGINS`, requires the application gate to be enabled, and requires an access token
of at least 32 characters. It also asks `cloudflared` to validate the config and confirms that
the first ingress rule matching the public URL routes exactly to `http://127.0.0.1:3070`.
The watchdog repeats these fail-closed checks before every start. It exits before registering
or starting the task if any check fails.

That installs pnpm on PATH, disables the corepack prompt, registers the **PortaWatchdog**
scheduled task (every 5 minutes + at logon), and brings the pipeline up immediately.

The installer never overwrites an existing same-name task. Stop the current installation with
`stop-watchdog.ps1` before reinstalling. It also refuses to start while an untracked launcher
from the legacy VBS recipe is still using this checkout, and reports the PID for manual review
instead of guessing that it is safe to kill.

To customise the origin port, keep all three values identical: `PORTA_WEB_PORT` in `.env`,
the installer's `-OriginPort` argument, and the `service` port in Cloudflare's `config.yml`.
The tunnel readiness endpoint uses `127.0.0.1:20241` by default; choose another unused port
with `-TunnelMetricsPort` if needed.

## Files

| File | Role |
|---|---|
| `install-watchdog.ps1` | one-time, no-admin setup: pnpm-on-PATH + scheduled task |
| `stop-watchdog.ps1` | unregister the task and stop only its identity-validated, tracked process trees |
| `porta-watchdog.ps1` | checks the tracked Porta web/proxy and tunnel readiness, then heals either component independently |
| `managed-runner.ps1` | owns one component tree in a kill-on-close Windows Job Object and records its PID, start time, runner path, and deployment id |
| `watchdog-common.ps1` | shared identity, state, discovery, and safe process-tree helpers |
| `run-porta.bat` | runs the Porta app under its managed runner |
| `run-tunnel.bat` | runs the configured tunnel with a loopback-only readiness endpoint |

## Verify / operate

```powershell
# is the scheduled watchdog active, and is its exact tunnel connected?
Get-ScheduledTask -TaskName PortaWatchdog
Invoke-WebRequest http://127.0.0.1:20241/ready -UseBasicParsing |
    Select-Object StatusCode

# An unsigned request should be denied by the application gate (401), or by Cloudflare Access.
try {
    (Invoke-WebRequest https://<your-host>/ -UseBasicParsing).StatusCode
} catch {
    $_.Exception.Response.StatusCode.value__
}

# watch the newest identity-scoped watchdog log
$watchdogLog = Get-ChildItem .\deploy\windows\watchdog-*.log |
    Sort-Object LastWriteTime | Select-Object -Last 1
Get-Content $watchdogLog.FullName -Tail 20 -Wait

# tunnel output is identity-scoped under LocalAppData
$repoRoot = (Resolve-Path .).Path
. .\deploy\windows\watchdog-common.ps1
$instanceId = Get-PortaInstanceId -RepoRoot $repoRoot -TaskName PortaWatchdog
$stateDir = Get-PortaStateDirectory -InstanceId $instanceId
Get-Content (Join-Path $stateDir tunnel.log) -Tail 20 -Wait

# force a health check now
Start-ScheduledTask -TaskName PortaWatchdog

# unregister the task and safely stop its tracked Porta + tunnel processes
.\deploy\windows\stop-watchdog.ps1
```

`Unregister-ScheduledTask` by itself only disables future healing; it does **not** stop
already-running Porta or tunnel processes. Use `stop-watchdog.ps1` to stop the identity-validated
process trees too. A legacy or otherwise untracked launcher is reported but not killed
automatically.

> Note: `watchdog-*.log`, `logs/`, and `*.log` are git-ignored — these scripts only ever write
> logs outside version control.
