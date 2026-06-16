import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { TrajectoryStep } from "../types";
import { useAppResume } from "./useAppResume";

/** How many steps to fetch on initial load and each lazy-load page. */
const PAGE_SIZE = 100;

interface UseStepsStreamResult {
  /** All loaded steps (ordered oldest → newest). */
  steps: TrajectoryStep[];
  loading: boolean;
  error: string | null;
  /** Whether older steps exist above the currently loaded window. */
  hasMore: boolean;
  /** True while a loadOlder request is in flight. */
  loadingOlder: boolean;
  /** WS-driven running state — instant, not dependent on 15s sidebar poll. */
  wsRunning: boolean;
  /** Load the next page of older steps. Returns the count prepended. */
  loadOlder: () => Promise<number>;
  /** Soft refresh: merge new steps without clearing existing messages. */
  refresh: () => void;
  /** Hard refresh: full nuke-and-reload (for revert/stop). */
  hardRefresh: () => void;
}

/**
 * Chat steps hook: HTTP for initial + lazy load, WS for real-time deltas.
 *
 * Initial flow:
 *   1. HTTP GET /steps?limit=PAGE_SIZE → latest page of steps
 *   2. Open WS → receive { type: "ready", stepCount }
 *   3. Send WS { type: "sync", fromOffset: loadedOffset + loadedCount }
 *      so WS delta polling picks up from where HTTP left off
 *   4. WS pushes { type: "steps", offset, steps } for new/updated steps
 *
 * Lazy load (scroll up):
 *   5. HTTP GET /steps?offset=X → older page
 *   6. Prepend to steps array
 */
export function useStepsStream(
  cascadeId: string,
  totalStepCount?: number,
  onIdleTransition?: () => void,
  isConversationRunning = false,
  keepAliveWhenHidden = false,
): UseStepsStreamResult {
  const [steps, setSteps] = useState<TrajectoryStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [wsRunning, setWsRunning] = useState(false);

  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepsRef = useRef<TrajectoryStep[]>([]);
  // The absolute offset of stepsRef[0] in the full trajectory.
  const baseOffsetRef = useRef(0);
  // The exact offset of the NEXT step AFTER the end of stepsRef.
  const endOffsetRef = useRef(0);
  // Monotonic generation counter — prevents stale responses from overwriting.
  const genRef = useRef(0);

  // ── HTTP: initial load (latest N steps) ──
  const totalRef = useRef(totalStepCount ?? 0);
  totalRef.current = totalStepCount ?? 0;

  const onIdleRef = useRef(onIdleTransition);
  onIdleRef.current = onIdleTransition;
  const runningHintRef = useRef(isConversationRunning);
  runningHintRef.current = isConversationRunning;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const initialFetch = useCallback(async () => {
    const gen = genRef.current;
    try {
      // Calculate starting offset from the known total step count.
      // If we don't know the count, we use the `tail` parameter to let the proxy compute it.
      const isUnknown = totalRef.current === 0;
      const startOffset = isUnknown
        ? 0
        : Math.max(0, totalRef.current - PAGE_SIZE);
      console.debug(
        `[useStepsStream] initialFetch cascadeId=${cascadeId.slice(0, 8)} gen=${gen} total=${totalRef.current} isUnknown=${isUnknown} startOffset=${startOffset}`,
      );
      const result = await api.getSteps(
        cascadeId,
        startOffset,
        undefined,
        isUnknown ? PAGE_SIZE : undefined,
      );
      console.debug(
        `[useStepsStream] initialFetch result: mounted=${mountedRef.current} gen=${gen}==${genRef.current} steps=${(result.steps ?? []).length} offset=${result.offset}`,
      );
      if (!mountedRef.current || gen !== genRef.current) return;

      const fetchedSteps = result.steps ?? [];
      const offset = result.offset ?? startOffset;

      baseOffsetRef.current = offset;
      endOffsetRef.current = offset + fetchedSteps.length;
      stepsRef.current = fetchedSteps;
      setSteps([...fetchedSteps]);
      setHasMore(offset > 0);
      setLoading(false);
      setError(null);

      // Return the total so WS can sync from the right point
      return { offset, count: fetchedSteps.length };
    } catch (err) {
      if (!mountedRef.current || gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      return null;
    }
  }, [cascadeId]);

  // ── WS: connect for deltas ──
  const connectWs = useCallback(
    (syncOffset: number) => {
      if (!mountedRef.current) return;
      clearReconnectTimer();

      const existing = wsRef.current;
      if (existing && existing.readyState < WebSocket.CLOSING) {
        return;
      }

      const apiBase = import.meta.env.VITE_API_BASE ?? "";
      let url: string;
      if (apiBase) {
        const wsBase = apiBase.replace(/^http/, "ws");
        url = `${wsBase}/api/conversations/${cascadeId}/ws`;
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const baseUrl = import.meta.env.BASE_URL ?? "/";
        const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
        url = `${protocol}//${window.location.host}${cleanBaseUrl}/api/conversations/${cascadeId}/ws`;
      }
      const gen = genRef.current;

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (
            !mountedRef.current ||
            gen !== genRef.current ||
            wsRef.current !== ws
          ) {
            ws.close();
            return;
          }

          // Tell proxy to start deltas from where our HTTP load ended
          ws.send(JSON.stringify({ type: "sync", fromOffset: syncOffset }));
        };

        ws.onmessage = (event) => {
          if (
            !mountedRef.current ||
            gen !== genRef.current ||
            wsRef.current !== ws
          ) {
            return;
          }
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "ready") {
              // Proxy acknowledged connection with stepCount.
              // We already have initial data from HTTP, so just note it.
              return;
            }

            if (msg.type === "status") {
              // Instant running state from the proxy's adaptive polling.
              const running = !!msg.running;
              setWsRunning(running);
              if (!running) {
                // Agent just went idle — trigger sidebar refresh for metadata update
                onIdleRef.current?.();
              }
              return;
            }

            if (msg.type === "steps") {
              const deltaOffset: number = msg.offset ?? endOffsetRef.current;
              const newSteps: TrajectoryStep[] = msg.steps ?? [];
              if (newSteps.length === 0) return;

              // Calculate position relative to the END of our loaded window
              // (safely handles inner array gaps from lazy-loaded older steps)
              const relOffset =
                stepsRef.current.length + (deltaOffset - endOffsetRef.current);

              if (relOffset >= 0) {
                // Delta overlaps or extends our loaded window — merge
                const updated = stepsRef.current
                  .slice(0, relOffset)
                  .concat(newSteps);
                stepsRef.current = updated;
                endOffsetRef.current = deltaOffset + newSteps.length;
                setSteps([...updated]);
              }
              // If relOffset < 0, the delta is for steps before our window
              // (shouldn't happen in practice — ignore)
            }
          } catch {
            // Ignore malformed messages
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current || gen !== genRef.current) return;

          if (wsRef.current === ws) {
            wsRef.current = null;
          }

          if (
            typeof document !== "undefined" &&
            document.hidden &&
            !keepAliveWhenHidden
          ) {
            return;
          }

          const current = wsRef.current;
          if (current && current.readyState < WebSocket.CLOSING) return;

          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;

            if (!mountedRef.current || gen !== genRef.current) return;
            if (
              typeof document !== "undefined" &&
              document.hidden &&
              !keepAliveWhenHidden
            ) {
              return;
            }

            const activeSocket = wsRef.current;
            if (activeSocket && activeSocket.readyState < WebSocket.CLOSING) {
              return;
            }

            connectWs(endOffsetRef.current);
          }, 2000);
        };

        ws.onerror = () => {
          // onclose handles cleanup
        };
      } catch {
        // WS not available — no real-time updates
      }
    },
    [cascadeId, clearReconnectTimer, keepAliveWhenHidden],
  );

  // ── Lifecycle: fetch + connect ──
  useEffect(() => {
    mountedRef.current = true;
    genRef.current++;
    stepsRef.current = [];
    baseOffsetRef.current = 0;
    endOffsetRef.current = 0;
    setSteps([]);
    setLoading(true);
    setError(null);
    setHasMore(false);

    (async () => {
      const result = await initialFetch();
      if (!result || !mountedRef.current) return;
      // Connect WS, starting deltas from the end of our loaded window
      const syncFrom = result.offset + result.count;
      connectWs(syncFrom);
    })();

    return () => {
      mountedRef.current = false;
      genRef.current++;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [initialFetch, connectWs, clearReconnectTimer]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      if (!document.hidden) return;
      if (keepAliveWhenHidden) return;

      clearReconnectTimer();
      setWsRunning(false);

      const socket = wsRef.current;
      wsRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearReconnectTimer, keepAliveWhenHidden]);

  // ── Lazy load older steps ──
  const loadOlder = useCallback(async (): Promise<number> => {
    if (loadingOlder || baseOffsetRef.current <= 0) return 0;
    setLoadingOlder(true);
    const gen = genRef.current;

    try {
      const end = baseOffsetRef.current;
      const fetchOffset = Math.max(0, end - PAGE_SIZE);
      const limit = end - fetchOffset;

      const result = await api.getSteps(cascadeId, fetchOffset, limit);
      if (!mountedRef.current || gen !== genRef.current) return 0;

      const olderSteps = result.steps ?? [];
      if (olderSteps.length === 0) {
        setHasMore(false);
        return 0;
      }

      // The proxy returns the actual offset it used
      const actualOffset = result.offset ?? fetchOffset;

      // Prepend to existing steps
      baseOffsetRef.current = actualOffset;
      stepsRef.current = [...olderSteps, ...stepsRef.current];
      setSteps([...stepsRef.current]);
      setHasMore(actualOffset > 0);

      return olderSteps.length;
    } catch (err) {
      if (!mountedRef.current || gen !== genRef.current) return 0;
      console.error("Failed to load older steps:", err);
      return 0;
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  }, [cascadeId, loadingOlder]);

  const syncLatestSteps = useCallback(
    async (reconnectMode: "always" | "if-running") => {
      const gen = genRef.current;

      try {
        const isUnknown = totalRef.current === 0;
        const startOffset = isUnknown
          ? 0
          : Math.max(0, totalRef.current - PAGE_SIZE);
        const result = await api.getSteps(
          cascadeId,
          startOffset,
          undefined,
          isUnknown ? PAGE_SIZE : undefined,
        );
        if (!mountedRef.current || gen !== genRef.current) return;

        const fetchedSteps = result.steps ?? [];
        const fetchedOffset = result.offset ?? startOffset;

        if (stepsRef.current.length === 0) {
          // First load — just set everything
          baseOffsetRef.current = fetchedOffset;
          endOffsetRef.current = fetchedOffset + fetchedSteps.length;
          stepsRef.current = fetchedSteps;
          setSteps([...fetchedSteps]);
          setHasMore(fetchedOffset > 0);
          setLoading(false);
        } else {
          // Merge by replacing the fetched window while keeping older/newer
          // segments outside it. This preserves in-place step updates.
          const currentBase = baseOffsetRef.current;
          const currentEnd = currentBase + stepsRef.current.length;
          const fetchedEnd = fetchedOffset + fetchedSteps.length;
          const keepPrefixCount = Math.max(0, fetchedOffset - currentBase);
          const keepSuffixFrom = Math.max(0, fetchedEnd - currentBase);
          const merged = [
            ...stepsRef.current.slice(0, keepPrefixCount),
            ...fetchedSteps,
            ...stepsRef.current.slice(keepSuffixFrom),
          ];

          const newBase = Math.min(currentBase, fetchedOffset);
          baseOffsetRef.current = newBase;
          endOffsetRef.current = Math.max(currentEnd, fetchedEnd);
          stepsRef.current = merged;
          setSteps([...merged]);
          setHasMore(newBase > 0);
        }
        setError(null);

        const socket = wsRef.current;
        const socketAlive =
          !!socket && socket.readyState < WebSocket.CLOSING;
        if (socketAlive) return;

        if (reconnectMode === "always") {
          connectWs(endOffsetRef.current);
          return;
        }

        let shouldReconnect = runningHintRef.current;
        if (!shouldReconnect) {
          const conversation = await api.getConversation(cascadeId);
          if (!mountedRef.current || gen !== genRef.current) return;
          shouldReconnect =
            conversation.status === "CASCADE_RUN_STATUS_RUNNING";
        }

        if (shouldReconnect) {
          connectWs(endOffsetRef.current);
        }
      } catch (err) {
        if (!mountedRef.current || gen !== genRef.current) return;
        console.error("Soft refresh failed:", err);
      }
    },
    [cascadeId, connectWs],
  );

  // ── Soft refresh: merge new steps without clearing existing messages ──
  const refresh = useCallback(() => {
    void syncLatestSteps("always");
  }, [syncLatestSteps]);

  useAppResume(() => {
    // Even while idle we keep a WS open so the proxy can detect
    // externally-started runs. If the tab was backgrounded, always restore
    // that channel on resume instead of waiting for the next mutation.
    void syncLatestSteps("always");
  });

  // ── Hard refresh: full nuke-and-reload (for revert/stop) ──
  const hardRefresh = useCallback(() => {
    genRef.current++;
    stepsRef.current = [];
    baseOffsetRef.current = 0;
    endOffsetRef.current = 0;
    setSteps([]);
    setLoading(true);
    setError(null);
    setHasMore(false);

    if (wsRef.current) {
      clearReconnectTimer();
      wsRef.current.close();
      wsRef.current = null;
    }

    (async () => {
      const result = await initialFetch();
      if (!result || !mountedRef.current) return;
      const syncFrom = result.offset + result.count;
      connectWs(syncFrom);
    })();
  }, [initialFetch, connectWs, clearReconnectTimer]);

  return {
    steps,
    loading,
    error,
    hasMore,
    loadingOlder,
    wsRunning,
    loadOlder,
    refresh,
    hardRefresh,
  };
}
