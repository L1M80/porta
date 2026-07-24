---
name: porta-process-management
description: Restart, stop, inspect, and diagnose the local Porta dev server on Windows/Tailscale. Use when the user asks whether Porta is running, says the Porta Tailscale URL is not working, asks to restart Porta, asks about Antigravity IDE language-server discovery, or needs the Porta web/proxy processes made healthy.
---

# Porta Process Management

## Core Workflow

Work from `C:\Users\stlim\porta` unless the user explicitly names another checkout.

Prefer the repo scripts over ad hoc process commands:

```powershell
.\scripts\status-porta.ps1
.\scripts\restart-porta.ps1
.\scripts\restart-porta.ps1 -RequireLanguageServer
.\scripts\stop-porta.ps1
```

Use `-RequireLanguageServer` when the user needs the app to talk to Antigravity, not merely serve the web shell.

## Expected Healthy State

The Tailscale dev URL is:

```text
http://100.121.236.5:5173/
```

Healthy checks:

- `5173` serves the Vite web UI with HTTP 200.
- `5173/api/health` returns HTTP 200 quickly.
- `languageServers` contains at least one entry when Antigravity IDE is running and discoverable.
- The proxy listens on `100.121.236.5:3170`.
- There should not be a stray Vite listener on `5174`; that usually means a duplicate dev launcher was started while `5173` was occupied.

## Diagnosis Notes

If the web shell loads but the UI is stuck, check `/api/health`, `/api/workspaces`, and `/api/models`.

If Antigravity IDE is running but Porta reports `languageServers: []`, inspect the language server process:

```powershell
tasklist /FI "IMAGENAME eq language_server_windows_x64.exe" /V
wmic process where "name='language_server_windows_x64.exe'" get ProcessId,ParentProcessId,CommandLine /format:list
cmd /c netstat -ano | findstr <pid>
```

Current Antigravity IDE may launch the language server with only `--extension_server_port`; the actual RPC port can be a nearby hidden listener owned by the same PID. Porta discovers it by scanning listening ports for the language-server PID and probing `GetWorkspaceInfos`.

If Windows process or networking queries hang, retry with narrower commands such as `tasklist`, `wmic` for a specific process name, or `cmd /c netstat -ano | findstr <pid>`.

## Safety Rules

Stop only Porta dev process trees for the current repo, plus their child Vite/proxy processes. Do not kill broad `node.exe`, all PowerShell windows, Antigravity IDE, or unrelated developer processes unless the user specifically asks.

After process changes, report the branch, web URL status, health status, language-server count, and whether the worktree is clean.
