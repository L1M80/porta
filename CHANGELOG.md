# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-03-11

### Added

- **Inline command approval UI** — when the agent proposes a command and waits
  for user confirmation (`CORTEX_STEP_STATUS_WAITING`), the web chat now
  displays Approve / Reject buttons directly on the command card, with a
  pulsing "Waiting for approval" indicator. Users no longer need to leave the
  web interface to resolve pending actions.
- Proxy route `POST /api/conversations/:id/command-action` for command
  approve/reject via `HandleCascadeUserInteraction` RPC.
- `api.commandAction()` client method.
- Retry on failure: if the approve/reject request fails, buttons reappear so
  the user can try again.
- Unit tests for `CommandCard` (8 tests: visibility, callbacks, retry, display logic).
- Edge test for `proposedCommandLine`-only steps in `stepsToMessages`.

### Fixed

- Steps with only `proposedCommandLine` (no `commandLine`) were silently
  dropped by `stepsToMessages`, making it impossible to render waiting
  command cards. Now included in the fallback chain.

## [0.1.0] - 2026-03-10

Initial public release.

### Added

- Local proxy server bridging the browser to the Antigravity Language Server
- Automatic LS discovery via daemon files (all platforms) and process scanning (Linux, macOS)
- React SPA with real-time conversation streaming over WebSocket
- Progressive Web App (PWA) — installable on mobile and desktop
- LAN access via `PORTA_HOST` private IP binding
- Remote access via Cloudflare Named Tunnel + Pages + Zero Trust
- Cross-platform support: Linux (Tier 1), Windows (Tier 2), macOS (Tier 3)

[Unreleased]: https://github.com/L1M80/porta/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/L1M80/porta/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/L1M80/porta/releases/tag/v0.1.0
