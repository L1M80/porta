import { useState, useCallback } from "react";

/** Persist draft text per cascadeId across re-renders, HMR, and page reloads. */
const DRAFT_PREFIX = "porta:draft:";
const draftStore = {
  get(key: string): string {
    try {
      return localStorage.getItem(DRAFT_PREFIX + key) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string): void {
    try {
      if (value) {
        localStorage.setItem(DRAFT_PREFIX + key, value);
      } else {
        localStorage.removeItem(DRAFT_PREFIX + key);
      }
    } catch {
      // localStorage might be full or unavailable
    }
  },
  delete(key: string): void {
    try {
      localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  },
};

interface UseDraftTextResult {
  draftText: string;
  handleDraftChange: (text: string) => void;
}

/**
 * Manages per-conversation draft text with localStorage persistence.
 * Saves the current draft when switching away, loads the new draft when switching to.
 */
export function useDraftText(activeId: string | null): UseDraftTextResult {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = activeId ?? "__new__";
  const draftText = activeId
    ? (drafts[draftKey] ?? draftStore.get(activeId))
    : (drafts[draftKey] ?? "");

  const handleDraftChange = useCallback(
    (text: string) => {
      setDrafts((prev) => ({ ...prev, [draftKey]: text }));
      if (activeId) draftStore.set(activeId, text);
    },
    [activeId, draftKey],
  );

  return { draftText, handleDraftChange };
}

export { draftStore };
