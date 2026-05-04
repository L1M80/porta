import { useMemo, useState, useCallback } from "react";
import { api } from "../api/client";
import { usePolling } from "./usePolling";
import type { ConversationSummary, ConversationsResponse } from "../types";

export interface ConversationEntry {
  id: string;
  summary: ConversationSummary;
}

export function useConversations(intervalMs = 15_000) {
  const { data, error, loading, refresh } = usePolling<ConversationsResponse>(
    api.conversations,
    intervalMs,
  );

  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const optimisticRemove = useCallback((id: string) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const conversations = useMemo<ConversationEntry[]>(() => {
    if (!data?.trajectorySummaries) return [];

    const finalArray = Object.entries(data.trajectorySummaries)
      .filter(([id]) => !deletedIds.has(id))
      .map(([id, summary]) => ({ id, summary }))
      .sort(
        (a, b) =>
          new Date(b.summary.lastModifiedTime).getTime() -
          new Date(a.summary.lastModifiedTime).getTime(),
      );

    return finalArray;
  }, [data, deletedIds]);

  return { conversations, error, loading, refresh, optimisticRemove };
}
