import { afterEach, describe, expect, it, vi } from "vitest";

async function loadApi(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return (await import("../api/client")).api;
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("parses JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ok",
            proxy: { port: 3100, uptime: 1 },
            languageServers: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const api = await loadApi();
    await expect(api.health()).resolves.toMatchObject({ status: "ok" });
  });

  it("throws a clear error when the API returns HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><html><body>Not JSON</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    const api = await loadApi();
    await expect(api.health()).rejects.toThrow(
      "API returned non-JSON for /api/health: <!doctype html><html><body>Not JSON</body></html>",
    );
  });

  it("keeps same-origin API calls rooted at /api when PORTA_BASE_PATH is set", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const api = await loadApi({ PORTA_BASE_PATH: "/porta/" });
    await api.health();
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("uses VITE_API_BASE when it is explicitly set", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const api = await loadApi({
      PORTA_BASE_PATH: "/porta/",
      VITE_API_BASE: "https://api.example.test",
    });
    await api.health();
    expect(fetchStub).toHaveBeenCalledWith(
      "https://api.example.test/api/health",
      expect.anything(),
    );
  });
});
