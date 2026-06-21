# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.11.0] - 2026-06-21

### Added

- `pnpm dev:cloud` now supports `PORTA_CLOUDFLARED_CONFIG`, and `.env`
  parsing allows inline comments while preserving quoted `#` characters. (#93)

### Fixed

- **Antigravity ask-question prompts are now visible and actionable in the web
  UI** with selectable options, Skip/Submit actions, and write-in responses
  for custom answers. (#76, #96)
- **Conversation discovery now scans the active Antigravity app-data tree**
  reported by daemon/process discovery instead of always using the legacy
  directory, reducing disk-only conversations and avoiding repeated warm-up
  retries for conversations no running Language Server can load. (#94)

### Security

- Updated Hono to 4.12.25 for upstream security fixes. (#89)
- Updated Undici to 7.28.0 and Vite to 8.0.16, including upstream security
  fixes and dev tooling updates. (#90)

## [0.10.0] - 2026-06-17

### Added

- **Container and reverse-proxy deployments are now easier to run** with
  container-aware Language Server discovery, explicit wildcard bind opt-in via
  `PORTA_ALLOW_WILDCARD=1`, configurable Vite dev host allowlists, and
  `PORTA_BASE_PATH` support for subpath-hosted frontend assets, routing, and
  PWA scope. (#85)

### Fixed

- Daemon Language Server entries now require a valid `GetWorkspaceInfos`
  network response before being kept, preventing stale daemon files from
  selecting unrelated local HTTP services in container deployments. (#85)
- Proxy steps responses now cap effective payload size across `limit`, `tail`,
  default fetches, and corrupted-step placeholders. (#86)

### Security

- Proxy error responses now redact raw thrown values and upstream RPC details,
  returning only safe client-facing messages while logging full details
  server-side. (#86)

## [0.9.0] - 2026-06-16

### Added

- Language Server discovery now scans both `~/.gemini/antigravity/daemon` and
  `~/.gemini/antigravity-ide/daemon`, so IDE-based Antigravity sessions are
  discovered out of the box. (#78)

### Fixed

- **Antigravity 2.x routing and workspace display now recover correctly** when
  conversations are disk-only, stored as `.db` files, or returned by an
  unscoped hub Language Server. Porta now persists conversation affinity,
  warms disk-only conversations, and keeps workspace metadata available after
  proxy restarts. (#75, #81)
- **Language Server RPC port discovery now rejects false-positive HTTP ports**
  by requiring `GetWorkspaceInfos` probes to return `200 OK`, preventing local
  non-RPC services from being selected as the Antigravity RPC endpoint. (#75,
  #81)
- **LAN/VPN development origins now work with `PORTA_HOST`** by binding the
  Vite dev server to the configured host and adding that host to proxy CORS
  allowlists. (#75, #81)
- Workspace names now decode URI path segments consistently and collapse
  Antigravity playground conversations under a stable sidebar label. (#75, #81)
- Draft text is now preserved more reliably while switching between
  conversations and new-message state. (#75, #81)

### Security

- Hardened markdown URI sanitization by stripping unsafe control characters
  before protocol checks. (#75, #81)
- Updated Vitest development dependencies. (#63)

## [0.8.0] - 2026-06-09

### Added

- **Browser notifications can now alert users when an agent run completes or
  approval is requested**, with a Settings toggle and permission handling for
  supported browsers. (#66, #69)

### Fixed

- **Antigravity generated implementation plans are now visible in chat** as a
  dedicated Implementation plan panel, including live display during active
  runs and pinned placement above the assistant response after completion.
  (#65, #71)

## [0.7.0] - 2026-06-02

### Fixed

- **Antigravity 2.x conversation metadata is now normalized** so workspace and
  conversation history discovery continues to work when the Language Server
  reports workspaces under `trajectoryMetadata`. (#56, #57)
- **Localized Windows `netstat` output is now parsed without relying on the
  English `LISTENING` state**, fixing local Language Server discovery on
  non-English Windows installations. (#52, #59)

### Security

- Bumped vulnerable `brace-expansion` transitive dependency versions in the
  lockfiles. (#53, #54)

## [0.6.0] - 2026-05-12

### Fixed

- **Terminal command approvals now use the current Antigravity LS interaction
  shape** by sending `permission.allow` to `HandleCascadeUserInteraction`,
  fixing `unexpected user interaction type: not permission` errors when
  approving or rejecting proposed commands. (#47)

## [0.5.0] - 2026-05-04

### Added

- **Cloudflare Access secured API proxy** — Cloudflare Pages can now route
  relative `/api/*` requests through a Pages Function that injects
  server-side Cloudflare Access service token headers for the protected backend
  API. The setup documentation now requires protecting both the Pages frontend
  and backend API with Cloudflare Access. (#40)
- Local Vite dev proxy support for `CF_ACCESS_CLIENT_ID` and
  `CF_ACCESS_CLIENT_SECRET`, making protected API development easier. (#40)

### Fixed

- **Deleted conversations now disappear from the sidebar immediately** after a
  successful delete request, instead of waiting for the next full refresh. (#42)
- Cloudflare Pages deploys now run Wrangler from the web package directory and
  deploy `./dist`, matching the Pages Functions layout. (#40)
- The Pages API proxy strips upstream `Set-Cookie` headers so backend
  Cloudflare Access cookies cannot overwrite the frontend Access session. (#40)

### Security

- Bumped `happy-dom` and related transitive dependencies. (#35)

## [0.4.0] - 2026-03-28

### Added

- **Zero-config remote access via Tailscale** — new `pnpm dev:tailscale`
  command discovers the Tailscale IPv4 address, binds the proxy and web app to
  it, and configures CORS for the Tailscale origin. (#34)

### Changed

- The exposure guard now permits Tailscale CGNAT addresses only when explicitly
  enabled with `PORTA_TAILSCALE=1`. (#34)

## [0.3.0] - 2026-03-14

### Added

- **Settings screen** — new settings panel accessible from the sidebar gear
  icon (⚙). Users can now configure persistent preferences that survive across
  sessions. Settings are stored globally in `localStorage`. (#5, #11)
- **Default model setting** — choose which model is pre-selected for new
  messages, instead of relying on the hardcoded constant.
- **Default planner type setting** — choose between Fast (conversational) and
  Plan (multi-step structured) as the default planner mode.
- New `useClientSettings` hook for global settings management with cross-tab
  sync via `storage` events.
- `SettingsPanel` component at `/:projectSlug/settings` route.
- `IconGear` and `IconChevronLeft` SVG icons.

### Fixed

- **PWA stale cache on deploy** — `index.html` is no longer precached by the
  Service Worker, and the `NavigationRoute` has been removed. Navigations now
  always hit the CDN, ensuring deployments take effect on the next reload
  without requiring users to clear caches or re-add the PWA. (#11)

### Changed

- Branch naming lint now bypasses the `develop` integration branch. (#13)

### Security

- Bumped `undici` to 7.24.1 (GHSA advisory). (#9)
- Bumped `express` and `cookie` in proxy dependencies. (#3)

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

[Unreleased]: https://github.com/L1M80/porta/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/L1M80/porta/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/L1M80/porta/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/L1M80/porta/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/L1M80/porta/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/L1M80/porta/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/L1M80/porta/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/L1M80/porta/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/L1M80/porta/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/L1M80/porta/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/L1M80/porta/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/L1M80/porta/releases/tag/v0.1.0
