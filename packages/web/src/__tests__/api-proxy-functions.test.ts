import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyApiRequest } from "../../functions/apiProxy";

describe("Pages API proxy function", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips the app base path before proxying subpath API requests", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response("{}", {
        headers: { "Set-Cookie": "CF_Authorization=backend" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const response = await proxyApiRequest(
      {
        request: new Request("https://porta.example/porta/api/health?x=1"),
        env: { PORTA_API_BASE: "https://api.example" },
      },
      { stripPathPrefix: "/porta" },
    );

    expect(fetchStub).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.example/api/health?x=1",
      }),
    );
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });
});
