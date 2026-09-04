import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useClientSettings } from "../hooks/useClientSettings";

describe("useClientSettings", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("restores the selected target engine after a reload", () => {
    const first = renderHook(() => useClientSettings());

    act(() => {
      first.result.current.updateSettings({ targetApp: "antigravity-ide" });
    });
    first.unmount();

    const reloaded = renderHook(() => useClientSettings());

    expect(reloaded.result.current.settings.targetApp).toBe("antigravity-ide");
  });
});
