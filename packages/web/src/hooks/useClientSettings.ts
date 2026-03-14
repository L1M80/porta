/**
 * Global client settings stored in localStorage.
 *
 * A single key (`porta:settings`) holds all settings across workspaces.
 * Cross-tab sync via the `storage` event.
 */

import { useState, useEffect, useCallback } from "react";
import type { ClientSettings } from "../types";
import { DEFAULT_MODEL } from "../constants";

const STORAGE_KEY = "porta:settings";

const DEFAULT_SETTINGS: ClientSettings = {
  defaultModel: DEFAULT_MODEL,
};

function readSettings(): ClientSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: ClientSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable — silently degrade
  }
}

export function useClientSettings() {
  const [settings, setSettings] = useState<ClientSettings>(readSettings);

  // Listen for cross-tab storage events
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setSettings(readSettings());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const updateSettings = useCallback((patch: Partial<ClientSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeSettings(next);
      return next;
    });
  }, []);

  return { settings, updateSettings } as const;
}
