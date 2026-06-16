import { useEffect, useRef } from "react";

interface UseAppResumeOptions {
  enabled?: boolean;
  dedupeMs?: number;
}

/**
 * Fire once when the app returns to the foreground, even if the browser emits
 * multiple closely-spaced resume signals for the same transition.
 */
export function useAppResume(
  onResume: () => void,
  { enabled = true, dedupeMs = 250 }: UseAppResumeOptions = {},
): void {
  const lastResumeAtRef = useRef<number>(-Infinity);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const emitResume = () => {
      if (document.hidden) return;

      const now = Date.now();
      if (now - lastResumeAtRef.current < dedupeMs) return;

      lastResumeAtRef.current = now;
      onResume();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        emitResume();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", emitResume);
    window.addEventListener("focus", emitResume);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", emitResume);
      window.removeEventListener("focus", emitResume);
    };
  }, [enabled, dedupeMs, onResume]);
}
