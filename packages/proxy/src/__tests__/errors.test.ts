import { describe, it, expect } from "vitest";
import { RPCError } from "../rpc.js";
import { handleRPCError } from "../errors.js";

/** Minimal Hono-like context stub */
function mockContext() {
  let captured: { body: unknown; status: number } | null = null;
  return {
    json(body: unknown, status?: number) {
      captured = { body, status: status ?? 200 };
      return captured;
    },
    get result() {
      return captured;
    },
  };
}

describe("handleRPCError", () => {
  it("maps 'unauthenticated' RPCError to 401", () => {
    const c = mockContext();
    handleRPCError(c, new RPCError("bad token", "unauthenticated"));
    expect(c.result).toEqual({
      body: { error: "Internal Server Error", code: "unauthenticated" },
      status: 401,
    });
  });

  it("maps 'unavailable' RPCError to 503", () => {
    const c = mockContext();
    handleRPCError(c, new RPCError("no LS", "unavailable"));
    expect(c.result).toEqual({
      body: { error: "Internal Server Error", code: "unavailable" },
      status: 503,
    });
  });

  it("maps unknown RPCError codes to 502", () => {
    const c = mockContext();
    handleRPCError(c, new RPCError("rpc fail", "internal"));
    expect(c.result).toEqual({
      body: { error: "Internal Server Error", code: "internal" },
      status: 502,
    });
  });

  it("handles generic Error by redacting details", () => {
    const c = mockContext();
    handleRPCError(c, new Error("something unexpected"));
    expect(c.result).toEqual({
      body: { error: "Internal Server Error" },
      status: 500,
    });
  });

  it("handles string errors by redacting details", () => {
    const c = mockContext();
    handleRPCError(c, "raw string error");
    expect(c.result).toEqual({
      body: { error: "Internal Server Error" },
      status: 500,
    });
  });
});
