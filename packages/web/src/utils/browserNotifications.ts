export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

interface ShowBrowserNotificationOptions {
  title: string;
  body?: string;
  tag?: string;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    typeof window.Notification === "undefined"
  ) {
    return "unsupported";
  }

  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    typeof window.Notification === "undefined"
  ) {
    return "unsupported";
  }

  return window.Notification.requestPermission();
}

export function shouldShowBrowserNotification(): boolean {
  if (typeof document === "undefined") return true;

  if (document.hidden) return true;
  if (typeof document.hasFocus === "function") {
    return !document.hasFocus();
  }

  return false;
}

export function showBrowserNotification({
  title,
  body,
  tag,
}: ShowBrowserNotificationOptions): boolean {
  if (getBrowserNotificationPermission() !== "granted") return false;
  if (!shouldShowBrowserNotification()) return false;

  try {
    const notification = new window.Notification(title, {
      body,
      tag,
      icon: "/icons/icon-192.png",
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    window.setTimeout(() => notification.close(), 10_000);
    return true;
  } catch {
    return false;
  }
}
