import type { Plugin } from "vite";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * Cookie-based access gate for the Porta dev server.
 *
 * When enabled, EVERY request (page, /api, and WebSocket upgrades) must present a
 * valid access token — otherwise it is rejected. This is the first line of defence
 * for a Porta instance exposed to the public internet via a tunnel. It is designed
 * to compose with Cloudflare Access (edge auth); it is not a replacement for it.
 *
 * Flow for the legitimate user (once):
 *   1. Visit https://<host>/?access_token=<TOKEN>
 *   2. The gate validates it, sets an HttpOnly cookie, and redirects to a clean URL.
 *   3. The cookie authenticates all later requests, including WebSockets (browsers
 *      send cookies on same-origin WS handshakes, but NOT Basic-Auth headers — which
 *      is why this uses a cookie rather than HTTP Basic Auth).
 *
 * Fail-closed: if `enabled` is true but no token is configured, everything is denied.
 */

const COOKIE_NAME = "porta_access";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function tokenFromQuery(url: string | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  if (q < 0) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  return params.get("access_token");
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  if (!token) return false;
  const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
  if (cookie && safeEqual(cookie, token)) return true;
  const q = tokenFromQuery(req.url);
  return !!q && safeEqual(q, token);
}

export function accessGate(opts: { enabled: boolean; token: string }): Plugin {
  return {
    name: "porta-access-gate",
    configureServer(server) {
      if (!opts.enabled) return; // local dev with no gate configured

      // --- HTTP (page + /api) ---
      server.middlewares.use((req, res, next) => {
        if (!opts.token) {
          res.statusCode = 503;
          res.end(
            "Access control is enabled (PORTA_REQUIRE_AUTH) but PORTA_ACCESS_TOKEN is not set.",
          );
          return;
        }

        const cookieVal = readCookie(req.headers.cookie, COOKIE_NAME);
        if (cookieVal && safeEqual(cookieVal, opts.token)) return next();

        // Bootstrap: a valid ?access_token= sets the cookie and redirects to a clean URL.
        const q = tokenFromQuery(req.url);
        if (q && safeEqual(q, opts.token)) {
          const path = (req.url ?? "/").split("?")[0] || "/";
          res.statusCode = 302;
          res.setHeader(
            "Set-Cookie",
            `${COOKIE_NAME}=${encodeURIComponent(opts.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
          );
          res.setHeader("Location", path);
          res.end();
          return;
        }

        res.statusCode = 401;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          "<!doctype html><meta charset=utf-8><title>Unauthorized</title>" +
            "<body style='font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem'>" +
            "<h1>401 — Access restricted</h1>" +
            "<p>This endpoint is private. Append <code>?access_token=YOUR_TOKEN</code> to the URL once to sign in.</p>",
        );
      });

      // --- WebSocket upgrades (/api streaming, Vite HMR) ---
      // Run before Vite's own upgrade handler so unauthorized sockets never reach it.
      const httpServer = server.httpServer;
      if (httpServer) {
        httpServer.prependListener(
          "upgrade",
          (req: IncomingMessage, socket: Duplex) => {
            if (!isAuthorized(req, opts.token)) {
              socket.write(
                "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
              );
              socket.destroy();
            }
          },
        );
      }
    },
  };
}
