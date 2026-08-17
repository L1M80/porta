import { describe, expect, it } from "vitest";
import {
  buildRecoverableStepDelta,
  getActivePollFetchOffset,
  shouldActivateIdlePolling,
  validateWebSocketUpgrade,
} from "../ws.js";
import { getAllowedOrigins } from "../origins.js";

describe("WS step recovery", () => {
  it("skips overlap before a known poison offset", () => {
    const delta = buildRecoverableStepDelta(
      105,
      0,
      101,
      "Language Server: step exceeds 4MB protobuf limit",
    );

    expect(delta.steps).toHaveLength(0);
    expect(delta.nextEndOffset).toBe(105);
    expect(delta.nextMinFetchOffset).toBe(101);
    expect(getActivePollFetchOffset(105, delta.nextMinFetchOffset, true)).toBe(
      101,
    );
  });

  it("emits placeholders only for unseen bad steps", () => {
    const delta = buildRecoverableStepDelta(
      100,
      0,
      101,
      "Language Server: step exceeds 4MB protobuf limit",
    );

    expect(delta.offset).toBe(100);
    expect(delta.steps).toHaveLength(1);
    expect(delta.steps[0].userInput?.items?.[0]?.text).toContain("4MB");
    expect(delta.nextEndOffset).toBe(101);
    expect(delta.nextMinFetchOffset).toBe(101);
    expect(delta.grew).toBe(true);
  });

  it("honors the poison floor even when no overlap is requested", () => {
    expect(getActivePollFetchOffset(10, 14, false)).toBe(14);
  });

  it("activates idle polling when an external run is active", () => {
    expect(shouldActivateIdlePolling(12, "CASCADE_RUN_STATUS_RUNNING", 12)).toBe(
      true,
    );
  });

  it("activates idle polling when externally-added steps appear", () => {
    expect(shouldActivateIdlePolling(12, "CASCADE_RUN_STATUS_IDLE", 13)).toBe(
      true,
    );
  });

  it("stays idle when no external progress is visible", () => {
    expect(shouldActivateIdlePolling(12, "CASCADE_RUN_STATUS_IDLE", 12)).toBe(
      false,
    );
  });
});

describe("WS upgrade validation", () => {
  it("accepts conversation WS paths from allowed origins", () => {
    const allowedOrigins = getAllowedOrigins({
      PORTA_CORS_ORIGINS: "https://porta.example",
    });

    expect(
      validateWebSocketUpgrade(
        "/api/conversations/abc123/ws",
        "https://porta.example",
        3100,
        allowedOrigins,
      ),
    ).toEqual({ ok: true, cascadeId: "abc123" });
  });

  it("keeps the selected target on the WebSocket upgrade", () => {
    expect(
      validateWebSocketUpgrade(
        "/api/conversations/abc123/ws?targetApp=antigravity-ide",
        "http://localhost:5173",
        3100,
      ),
    ).toEqual({
      ok: true,
      cascadeId: "abc123",
      targetApp: "antigravity-ide",
    });
  });

  it("rejects cross-origin upgrades on the WS endpoint", () => {
    const allowedOrigins = getAllowedOrigins({});

    expect(
      validateWebSocketUpgrade(
        "/api/conversations/abc123/ws",
        "https://evil.example",
        3100,
        allowedOrigins,
      ),
    ).toEqual({ ok: false, code: "forbidden_origin" });
  });

  it("ignores unrelated upgrade paths", () => {
    expect(
      validateWebSocketUpgrade(
        "/api/conversations/abc123/stream",
        "http://localhost:5173",
        3100,
      ),
    ).toEqual({ ok: false, code: "not_found" });
  });
});
