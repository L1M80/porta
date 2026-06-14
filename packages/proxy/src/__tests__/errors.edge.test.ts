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

describe("handleRPCError — extended edge cases", () => {
  it("maps 'not_found' RPCError to 502 (non-special code)", () => {
    const c = mockContext();
    handleRPCError(c, new RPCError("not found", "not_found"));
    expect(c.result).toEqual({
      body: { error: "not found", code: "not_found" },
      status: 502,
    });
  });

  it("maps 'permission_denied' RPCError to 502", () => {
    const c = mockContext();
    handleRPCError(c, new RPCError("denied", "permission_denied"));
    expect(c.result).toEqual({
      body: { error: "denied", code: "permission_denied" },
      status: 502,
    });
  });

  it("handles numeric error values", () => {
    const c = mockContext();
    handleRPCError(c, 42);
    expect(c.result).toEqual({
      body: { error: "Internal Server Error" },
      status: 500,
    });
  });

  it("handles null error", () => {
    const c = mockContext();
    handleRPCError(c, null);
    expect(c.result).toEqual({
      body: { error: "Internal Server Error" },
      status: 500,
    });
  });

  it("handles undefined error", () => {
    const c = mockContext();
    handleRPCError(c, undefined);
    expect(c.result).toEqual({
      body: { error: "Internal Server Error" },
      status: 500,
    });
  });

  it("handles Error subclass", () => {
    class CustomError extends Error {
      constructor() {
        super("custom error");
        this.name = "CustomError";
      }
    }
    const c = mockContext();
    handleRPCError(c, new CustomError());
    expect(c.result).toEqual({
      body: { error: "Internal Server Error" },
      status: 500,
    });
  });

  it("handles object error (non-Error)", () => {
    const c = mockContext();
    handleRPCError(c, { message: "object error" });
    expect(c.result).toEqual({
      body: { error: "Internal Server Error" },
      status: 500,
    });
  });

  it("preserves RPCError message with special characters", () => {
    const c = mockContext();
    const msg = 'RPC failed: status=503, body="{"error":"timeout"}"';
    handleRPCError(c, new RPCError(msg, "unavailable"));
    expect(c.result?.body).toEqual({ error: msg, code: "unavailable" });
    expect(c.result?.status).toBe(503);
  });
});

describe("RPCError — extended", () => {
  it("preserves stack trace", () => {
    const err = new RPCError("test", "test_code");
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain("RPCError");
  });

  it("can be caught as Error", () => {
    let caught = false;
    try {
      throw new RPCError("fail", "internal");
    } catch (e) {
      if (e instanceof Error) caught = true;
    }
    expect(caught).toBe(true);
  });

  it("has enumerable code property", () => {
    const err = new RPCError("msg", "my_code");
    expect(err.code).toBe("my_code");
    expect(err.message).toBe("msg");
    expect(err.name).toBe("RPCError");
  });
});
