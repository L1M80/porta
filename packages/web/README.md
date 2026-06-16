# @porta/web

React SPA frontend for Porta. Built with Vite + TypeScript, deployed as static files.

## Development

```bash
pnpm dev        # Start Vite dev server (http://localhost:5173)
pnpm build      # Production build → dist/
pnpm lint       # ESLint
pnpm test       # Vitest
```

## Architecture

- **Router:** React Router v7 with `BrowserRouter`; set `PORTA_BASE_PATH` when hosting under a subpath.
- **State:** React hooks + context. No external state management library.
- **Styling:** Vanilla CSS with CSS custom properties.
- **PWA:** `vite-plugin-pwa` with `autoUpdate` strategy.
- **Markdown:** `marked` for rendering assistant responses.

## Build-time environment

| Variable          | Description                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PORTA_BASE_PATH` | Optional deployment subpath such as `/porta`. Drives Vite asset URLs, React Router basename, relative API URLs, and PWA scope. |
| `VITE_API_BASE`   | Absolute API URL for production builds. When unset, API calls are relative to `PORTA_BASE_PATH` and Vite proxies them locally. |

The `envDir` in `vite.config.ts` is set to the repo root (`../..` from `packages/web`), so `.env*` files in the repo root are picked up automatically.
