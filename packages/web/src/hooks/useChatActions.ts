import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { draftStore } from "./useDraftText";
import { slugFromUri } from "./useWorkspaces";
import type { ChatMessage, MediaAttachment } from "../types";
import type { PlannerType } from "../components/ChatInput";
import { DEFAULT_MODEL } from "../constants";

interface UseChatActionsArgs {
  activeId: string | null;
  currentWorkspaceUri: string | undefined;
  projectSlug: string | undefined;
  refresh: () => void;
  conversations: {
    id: string;
    summary: {
      stepCount?: number;
      workspaces?: { workspaceFolderAbsoluteUri?: string }[];
    };
  }[];
  optimisticRemove?: (id: string) => void;
}

interface UseChatActionsResult {
  optimisticMessages: ChatMessage[];
  setOptimisticMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  confirmOptimisticMessages: (ids: string[]) => void;
  clearOptimisticMessages: () => void;
  stepsRefreshKey: number;
  hardRefreshKey: number;
  handleSend: (
    text: string,
    model: string | null,
    media?: MediaAttachment[],
    plannerType?: PlannerType,
    granted?: boolean,
  ) => Promise<void>;
  handleStop: () => Promise<void>;

  handleRevert: (stepIndex: number, draftContent?: string) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  chatUrl: (convId: string) => string;
  /** Trigger a non-destructive step re-fetch (e.g. after permission approval). */
  triggerSoftRefresh: () => void;
}

/**
 * All chat mutation actions: send, stop, revert, delete.
 * Also manages optimistic messages and confirmation state.
 */
export function useChatActions({
  activeId,
  currentWorkspaceUri,
  projectSlug,
  refresh,
  conversations,
  optimisticRemove,
}: UseChatActionsArgs): UseChatActionsResult {
  const navigate = useNavigate();

  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>(
    [],
  );
  const [stepsRefreshKey, setStepsRefreshKey] = useState(0);
  const [hardRefreshKey, setHardRefreshKey] = useState(0);

  const clearOptimisticMessages = useCallback(() => {
    setOptimisticMessages([]);
  }, []);

  const confirmOptimisticMessages = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const confirmedIds = new Set(ids);
    setOptimisticMessages((prev) =>
      prev.filter(
        (msg) =>
          !(
            msg.role === "user" &&
            msg.optimisticId &&
            confirmedIds.has(msg.optimisticId)
          ),
      ),
    );
  }, []);

  // Build a chat URL for the given conversation ID
  const chatUrl = useCallback(
    (convId: string): string => {
      const conv = conversations.find((c) => c.id === convId);
      const ws = conv?.summary.workspaces?.[0];
      const uri = ws?.workspaceFolderAbsoluteUri;
      const slug = uri ? slugFromUri(uri) : (projectSlug ?? "unknown");
      return `/${slug}/${convId}`;
    },
    [conversations, projectSlug],
  );

  const handleSend = useCallback(
    async (
      text: string,
      model: string | null,
      media?: MediaAttachment[],
      plannerType?: PlannerType,
      granted = false,
    ) => {
      const trimmed = text.trim();
      if (!trimmed && (!media || media.length === 0)) return;

      const optimisticId =
        globalThis.crypto?.randomUUID?.() ??
        `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimistic: ChatMessage = {
        role: "user",
        content: trimmed,
        stepIndex: -1,
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        optimisticId,
        optimisticState: "unconfirmed",
        media: media?.map((m) => ({
          mimeType: m.mimeType,
          inlineData: m.inlineData,
        })),
      };
      setOptimisticMessages((prev) => [...prev, optimistic]);

      try {
        let cascadeId = activeId;

        // Lazy session creation: create on first message
        if (!cascadeId) {
          const result = await api.startConversation(
            currentWorkspaceUri || undefined,
            granted,
          );
          cascadeId = result.cascadeId;
          navigate(`/${projectSlug}/${cascadeId}`, { replace: true });
        }

        await api.sendMessage(
          cascadeId,
          [{ type: "text", text: trimmed || " " }],
          optimisticId,
          model ?? undefined,
          media && media.length > 0 ? media : undefined,
          plannerType,
          granted,
        );
        draftStore.delete(cascadeId);
        setStepsRefreshKey((k) => k + 1);
        refresh();
      } catch (err) {
        console.error("Failed to send message:", err);
        setOptimisticMessages((prev) =>
          prev.map((msg) =>
            msg.optimisticId === optimisticId
              ? { ...msg, optimisticState: "failed" }
              : msg,
          ),
        );
        const errorMsg: ChatMessage = {
          role: "system",
          content: `Failed to send: ${err instanceof Error ? err.message : "Unknown error"}`,
          stepIndex: -2,
          type: "error",
          icon: "alert",
        };
        setOptimisticMessages((prev) => [...prev, errorMsg]);
      }
    },
    [activeId, refresh, currentWorkspaceUri, projectSlug, navigate],
  );

  const handleStop = useCallback(async () => {
    if (!activeId) return;
    try {
      await api.stop(activeId);
      setHardRefreshKey((k) => k + 1);
      refresh();
    } catch (err) {
      console.error("Failed to stop:", err);
    }
  }, [activeId, refresh]);

  const handleRevert = useCallback(
    async (stepIndex: number, draftContent?: string) => {
      if (!activeId) return;
      try {
        const targetStep = Math.max(0, stepIndex - 1);
        await api.revert(activeId, targetStep, DEFAULT_MODEL);
        refresh();
        setHardRefreshKey((k) => k + 1);
        // Draft text restoration is handled by the caller
        if (draftContent) {
          draftStore.set(activeId, draftContent);
        }
      } catch (err) {
        console.error("Failed to revert:", err);
      }
    },
    [activeId, refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteConversation(id);
        optimisticRemove?.(id);
        if (activeId === id) {
          navigate(`/${projectSlug ?? "unknown"}`);
        }
        refresh();
      } catch (err) {
        console.error("Failed to delete:", err);
      }
    },
    [activeId, refresh, navigate, projectSlug, optimisticRemove],
  );

  const triggerSoftRefresh = useCallback(() => {
    setStepsRefreshKey((k) => k + 1);
  }, []);

  return {
    optimisticMessages,
    setOptimisticMessages,
    confirmOptimisticMessages,
    clearOptimisticMessages,
    stepsRefreshKey,
    hardRefreshKey,
    handleSend,
    handleStop,
    handleRevert,
    handleDelete,
    chatUrl,
    triggerSoftRefresh,
  };
}
