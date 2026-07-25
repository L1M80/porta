import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Connect, ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import { accessGate } from "./vite-access-gate";

type UpgradeListener = (request: IncomingMessage, socket: Duplex) => void;

function configureGate(options: { enabled: boolean; token: string }) {
  let middleware: Connect.NextHandleFunction | undefined;
  const httpServer = new EventEmitter();
  const server = {
    middlewares: {
      use: vi.fn((handler: Connect.NextHandleFunction) => {
        middleware = handler;
      }),
    },
    httpServer,
  } as unknown as ViteDevServer;
  const configureServer = accessGate(options).configureServer;

  if (typeof configureServer !== "function") {
    throw new Error("access gate does not expose a configureServer hook");
  }
  configureServer.call(
    {} as ThisParameterType<typeof configureServer>,
    server,
  );

  return {
    httpServer,
    getMiddleware() {
      if (!middleware) throw new Error("access gate middleware was not installed");
      return middleware;
    },
  };
}

function request(url = "/", cookie?: string): IncomingMessage {
  return {
    headers: cookie === undefined ? {} : { cookie },
    url,
  } as IncomingMessage;
}

function response() {
  const headers = new Map<string, number | string | readonly string[]>();
  const end = vi.fn();
  const res = {
    statusCode: 200,
    setHeader(name: string, value: number | string | readonly string[]) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end,
  } as unknown as ServerResponse;

  return { res, end, headers };
}

function socket() {
  const write = vi.fn();
  const destroy = vi.fn();
  return {
    value: { write, destroy } as unknown as Duplex,
    write,
    destroy,
  };
}

describe("accessGate", () => {
  it("does not install access control when disabled", () => {
    const { httpServer, getMiddleware } = configureGate({
      enabled: false,
      token: "secret",
    });

    expect(httpServer.listenerCount("upgrade")).toBe(0);
    expect(getMiddleware).toThrow("access gate middleware was not installed");
  });

  it("fails closed when enabled without a configured token", () => {
    const { httpServer, getMiddleware } = configureGate({
      enabled: true,
      token: "",
    });
    const { res, end } = response();
    const next = vi.fn();

    getMiddleware()(request(), res, next);

    expect(res.statusCode).toBe(503);
    expect(end).toHaveBeenCalledWith(
      "Access control is enabled (PORTA_REQUIRE_AUTH) but PORTA_ACCESS_TOKEN is not set.",
    );
    expect(next).not.toHaveBeenCalled();

    const ws = socket();
    httpServer.emit("upgrade", request(), ws.value);
    expect(ws.write).toHaveBeenCalledWith(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
    );
    expect(ws.destroy).toHaveBeenCalledOnce();
  });

  it("rejects an HTTP request without a token", () => {
    const { getMiddleware } = configureGate({
      enabled: true,
      token: "secret",
    });
    const { res, end, headers } = response();
    const next = vi.fn();

    getMiddleware()(request("/api/health"), res, next);

    expect(res.statusCode).toBe(401);
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(end).toHaveBeenCalledWith(expect.stringContaining("Unauthorized"));
    expect(next).not.toHaveBeenCalled();
  });

  it("sets a cookie for a valid query token and accepts it afterward", () => {
    const { getMiddleware } = configureGate({
      enabled: true,
      token: "a token/with=symbols",
    });
    const middleware = getMiddleware();
    const bootstrap = response();

    middleware(
      request("/chat?access_token=a+token%2Fwith%3Dsymbols&other=value"),
      bootstrap.res,
      vi.fn(),
    );

    expect(bootstrap.res.statusCode).toBe(302);
    expect(bootstrap.headers.get("location")).toBe("/chat");
    expect(bootstrap.headers.get("set-cookie")).toBe(
      "porta_access=a%20token%2Fwith%3Dsymbols; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000",
    );

    const authenticated = response();
    const next = vi.fn();
    middleware(
      request("/api/health", "other=x; porta_access=a%20token%2Fwith%3Dsymbols"),
      authenticated.res,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(authenticated.end).not.toHaveBeenCalled();
  });

  it("treats a malformed cookie as unauthenticated without crashing HTTP", () => {
    const { getMiddleware } = configureGate({
      enabled: true,
      token: "secret",
    });
    const { res, end } = response();
    const next = vi.fn();

    expect(() =>
      getMiddleware()(
        request("/", "porta_access=%E0%A4%A"),
        res,
        next,
      ),
    ).not.toThrow();

    expect(res.statusCode).toBe(401);
    expect(end).toHaveBeenCalledWith(expect.stringContaining("Unauthorized"));
    expect(next).not.toHaveBeenCalled();
  });

  it("still accepts a valid query token when the cookie is malformed", () => {
    const { getMiddleware } = configureGate({
      enabled: true,
      token: "secret",
    });
    const { res, headers } = response();

    expect(() =>
      getMiddleware()(
        request("/?access_token=secret", "porta_access=%E0%A4%A"),
        res,
        vi.fn(),
      ),
    ).not.toThrow();

    expect(res.statusCode).toBe(302);
    expect(headers.get("location")).toBe("/");
  });

  it("authorizes valid WebSocket upgrades and blocks missing credentials before downstream listeners", () => {
    const { httpServer } = configureGate({
      enabled: true,
      token: "secret",
    });
    const downstream = vi.fn<UpgradeListener>();
    httpServer.on("upgrade", downstream);

    const querySocket = socket();
    httpServer.emit(
      "upgrade",
      request("/api/stream?access_token=secret"),
      querySocket.value,
    );
    expect(querySocket.write).not.toHaveBeenCalled();
    expect(querySocket.destroy).not.toHaveBeenCalled();
    expect(downstream).toHaveBeenCalledOnce();

    downstream.mockClear();
    const cookieSocket = socket();
    httpServer.emit(
      "upgrade",
      request("/api/stream", "porta_access=secret"),
      cookieSocket.value,
    );
    expect(cookieSocket.write).not.toHaveBeenCalled();
    expect(cookieSocket.destroy).not.toHaveBeenCalled();
    expect(downstream).toHaveBeenCalledOnce();

    downstream.mockClear();
    const unauthorizedSocket = socket();
    httpServer.emit(
      "upgrade",
      request("/api/stream"),
      unauthorizedSocket.value,
    );
    expect(unauthorizedSocket.write).toHaveBeenCalledWith(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
    );
    expect(unauthorizedSocket.destroy).toHaveBeenCalledOnce();
    expect(downstream).not.toHaveBeenCalled();
  });

  it("rejects a malformed cookie during a raw WebSocket upgrade without throwing", () => {
    const { httpServer } = configureGate({
      enabled: true,
      token: "secret",
    });
    const ws = socket();

    expect(() =>
      httpServer.emit(
        "upgrade",
        request("/api/stream", "porta_access=%E0%A4%A"),
        ws.value,
      ),
    ).not.toThrow();

    expect(ws.write).toHaveBeenCalledWith(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
    );
    expect(ws.destroy).toHaveBeenCalledOnce();
  });
});
