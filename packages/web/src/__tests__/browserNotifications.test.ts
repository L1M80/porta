import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  showBrowserNotification,
} from "../utils/browserNotifications";

class MockNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  static created: MockNotification[] = [];

  title: string;
  options?: NotificationOptions;
  onclick: (() => void) | null = null;
  close = vi.fn();

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    MockNotification.created.push(this);
  }
}

function stubNotification(permission: NotificationPermission) {
  MockNotification.permission = permission;
  MockNotification.requestPermission.mockResolvedValue(permission);
  MockNotification.created = [];

  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: MockNotification,
  });
}

function stubAttentionNeeded(hidden: boolean, focused: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  Object.defineProperty(document, "hasFocus", {
    configurable: true,
    value: () => focused,
  });
}

describe("browserNotifications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    MockNotification.requestPermission.mockReset();
    MockNotification.created = [];
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined,
    });
    stubAttentionNeeded(false, true);
  });

  it("reports unsupported when Notification is unavailable", async () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined,
    });

    expect(getBrowserNotificationPermission()).toBe("unsupported");
    await expect(requestBrowserNotificationPermission()).resolves.toBe(
      "unsupported",
    );
  });

  it("creates a notification when permission is granted and the page needs attention", () => {
    vi.useFakeTimers();
    stubNotification("granted");
    stubAttentionNeeded(true, false);

    expect(
      showBrowserNotification({
        title: "Porta job finished",
        body: "Done",
        tag: "porta:test",
      }),
    ).toBe(true);

    expect(MockNotification.created).toHaveLength(1);
    expect(MockNotification.created[0].title).toBe("Porta job finished");
    expect(MockNotification.created[0].options).toMatchObject({
      body: "Done",
      tag: "porta:test",
      icon: "/icons/icon-192.png",
    });

    vi.advanceTimersByTime(10_000);
    expect(MockNotification.created[0].close).toHaveBeenCalled();
  });

  it("does not notify while the page is visible and focused", () => {
    stubNotification("granted");
    stubAttentionNeeded(false, true);

    expect(showBrowserNotification({ title: "Noop" })).toBe(false);
    expect(MockNotification.created).toHaveLength(0);
  });

  it("does not notify without granted permission", () => {
    stubNotification("default");
    stubAttentionNeeded(true, false);

    expect(showBrowserNotification({ title: "Noop" })).toBe(false);
    expect(MockNotification.created).toHaveLength(0);
  });
});
