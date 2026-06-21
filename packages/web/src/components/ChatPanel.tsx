import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { createPortal } from "react-dom";

import { useChatNotifications } from "../hooks/useChatNotifications";
import { useStepsStream } from "../hooks/useStepsStream";
import { stepsToMessages } from "../transforms/stepsToMessages";
import {
  isUnconfirmedOptimisticMessage,
  mergeOptimisticMessages,
} from "../utils/optimisticMessages";
import { renderMarkdown } from "../utils/markdown";
import { MarkdownContent } from "./MarkdownContent";
import {
  AskQuestionCard,
  CommandCard,
  CodeActionCard,
  FilePermissionCard,
} from "./StepCards";
import { getAskQuestionRequest, getFilePermissionRequest } from "../utils/stepCards";
import {
  IconCopy,
  IconCheck,
  IconUndo,
  IconSearch,
  IconFile,
  IconFileSearch,
  IconFolder,
  IconList,
  IconEye,
  IconMessageCircle,
  IconAlertTriangle,
  IconChevron,
} from "./Icons";
import type { AskQuestionEntry, ChatMessage } from "../types";

interface Props {
  cascadeId: string;
  onRevert: (stepIndex: number, editText?: string) => void;
  onFilePermission: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) => void;
  onCommandAction?: (
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) => Promise<void>;
  onAskQuestion?: (
    trajectoryId: string,
    stepIndex: number,
    responses: AskQuestionEntry[],
    cancelled?: boolean,
  ) => Promise<void>;
  onConfirmOptimistic?: (ids: string[]) => void;
  optimisticMessages?: ChatMessage[];
  refreshKey?: number;
  hardRefreshKey?: number;
  totalStepCount?: number;
  isConversationRunning?: boolean;
  browserNotificationsEnabled?: boolean;
  conversationTitle?: string;
  /** Called when the WS reports the agent went idle — triggers sidebar refresh. */
  onSidebarRefresh?: () => void;
}

/** Collapsible implementation plan block */
function ImplementationPlanBlock({
  plan,
  duration,
  live = false,
}: {
  plan: string;
  duration?: string;
  live?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(live);
  const renderedPlan = useMemo(() => renderMarkdown(plan), [plan]);
  let durationLabel = "";
  if (duration) {
    const match = duration.match(/([\d.]+)s/);
    if (match) {
      durationLabel = `${parseFloat(match[1]).toFixed(1)}s`;
    }
  }

  return (
    <details
      className={`implementation-plan-block${live ? " live" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="implementation-plan-header">
        <span className="implementation-plan-icon">
          <IconList size={13} />
        </span>
        <span className="implementation-plan-label">
          {live ? "Live implementation plan" : "Implementation plan"}
        </span>
        {live && (
          <span className="implementation-plan-live-badge">Live</span>
        )}
        {durationLabel && (
          <span className="implementation-plan-meta">{durationLabel}</span>
        )}
        <span className="implementation-plan-action">
          {open ? "Hide" : "View"}
        </span>
        <span className="implementation-plan-chevron">
          <IconChevron size={13} />
        </span>
      </summary>
      <div className="implementation-plan-content">
        <MarkdownContent html={renderedPlan} />
        <div className="implementation-plan-actions">
          <button
            className="msg-action-btn implementation-plan-copy"
            title="Copy implementation plan"
            onClick={() => {
              navigator.clipboard.writeText(plan).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          </button>
        </div>
      </div>
    </details>
  );
}

function textFromStepItems(items?: { text?: string }[]): string {
  if (!items) return "";
  return items
    .filter((item) => item.text?.trim())
    .map((item) => item.text!.trim())
    .join("\n\n");
}

function implementationPlanFromStep(step: ChatMessage["step"]): string {
  const plannerResponse = step?.plannerResponse;
  if (!plannerResponse) return "";

  const thinking = plannerResponse.thinking?.trim();
  if (thinking) return plannerResponse.thinking ?? "";

  const itemText = textFromStepItems(plannerResponse.items);
  if (!plannerResponse.modifiedResponse?.trim() && itemText) return itemText;

  return "";
}

interface LiveImplementationPlan {
  plan: string;
  duration?: string;
  stepIndex: number;
}

function latestImplementationPlan(
  steps: ChatMessage["step"][],
): LiveImplementationPlan | null {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    const plan = implementationPlanFromStep(step);
    if (plan.trim()) {
      return {
        plan,
        duration: step?.plannerResponse?.thinkingDuration,
        stepIndex: index,
      };
    }
  }

  return null;
}

/** Map icon key → Lucide component */
function MsgIcon({ name }: { name?: string }) {
  if (!name) return null;
  const s = 12;
  switch (name) {
    case "search":
      return <IconSearch size={s} />;
    case "eye":
      return <IconEye size={s} />;
    case "file":
      return <IconFile size={s} />;
    case "file-search":
      return <IconFileSearch size={s} />;
    case "folder":
      return <IconFolder size={s} />;
    case "list":
      return <IconList size={s} />;
    case "alert":
      return <IconAlertTriangle size={s} />;
    default:
      return null;
  }
}

function PinnedImplementationPlanMessage({
  implementationPlan,
  live,
}: {
  implementationPlan: LiveImplementationPlan;
  live: boolean;
}) {
  return (
    <div className="message assistant pinned-implementation-plan-message">
      <div
        className={`chat-block message-body pinned-implementation-plan-body${
          live ? " live" : ""
        }`}
      >
        <ImplementationPlanBlock
          plan={implementationPlan.plan}
          duration={implementationPlan.duration}
          live={live}
        />
      </div>
    </div>
  );
}

function SystemMessage({
  msg,
  onFilePermission,
  onCommandAction,
  onAskQuestion,
}: {
  msg: ChatMessage;
  onFilePermission: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) => void;
  onCommandAction?: (
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) => Promise<void>;
  onAskQuestion?: (
    trajectoryId: string,
    stepIndex: number,
    responses: AskQuestionEntry[],
    cancelled?: boolean,
  ) => Promise<void>;
}) {
  const renderedContent = useMemo(
    () => renderMarkdown(msg.content ?? ""),
    [msg.content],
  );

  if (msg.step) {
    // File permission request — render dedicated card
    if (msg.type === "CORTEX_STEP_TYPE_FILE_PERMISSION") {
      const fpr = getFilePermissionRequest(msg.step);
      if (fpr) {
        return (
          <div className="message system">
            <FilePermissionCard
              step={msg.step}
              permissionRequest={fpr}
              onFilePermission={onFilePermission}
            />
          </div>
        );
      }
    }
    if (msg.type === "CORTEX_STEP_TYPE_ASK_QUESTION") {
      const askQuestion = getAskQuestionRequest(msg.step);
      if (askQuestion) {
        return (
          <div className="message system">
            <AskQuestionCard
              step={msg.step}
              askQuestionRequest={askQuestion}
              fallbackStepIndex={msg.stepIndex}
              onAskQuestion={onAskQuestion}
            />
          </div>
        );
      }
    }
    if (msg.type === "CORTEX_STEP_TYPE_RUN_COMMAND") {
      return (
        <div className="message system">
          <CommandCard step={msg.step} onCommandAction={onCommandAction} />
        </div>
      );
    }
    if (msg.type === "CORTEX_STEP_TYPE_CODE_ACTION") {
      return (
        <div className="message system">
          <CodeActionCard step={msg.step} />
        </div>
      );
    }
  }

  return (
    <div className="message system">
      <div className="chat-block step-card info-card">
        <div className="step-card-header">
          {msg.icon && (
            <span className="step-card-icon">
              <MsgIcon name={msg.icon} />
            </span>
          )}
          <span
            className="info-card-text"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </div>
      </div>
    </div>
  );
}

interface MediaItem {
  mimeType?: string;
  inlineData?: string;
  payload?: { case?: string; value?: string };
}

/** Render media thumbnails from a user message */
function MediaThumbs({
  media,
  onImageClick,
}: {
  media: unknown[];
  onImageClick?: (src: string) => void;
}) {
  return (
    <div className="message-media">
      {media.map((m, i) => {
        const item = m as MediaItem;
        const mimeType = item.mimeType ?? "image/png";
        const inlineData =
          item.inlineData ??
          (item.payload?.case === "inlineData"
            ? item.payload.value
            : undefined);
        if (!inlineData) return null;
        const src = `data:${mimeType};base64,${inlineData}`;
        return (
          <img
            key={i}
            src={src}
            alt="attachment"
            className="message-media-thumb"
            onClick={() => onImageClick?.(src)}
          />
        );
      })}
    </div>
  );
}

/** Copy message text button */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-action-btn"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
    </button>
  );
}

/** Memoized message bubble — prevents WS-driven re-renders from destroying caret/selection */
interface MessageBubbleProps {
  msg: ChatMessage;
  isLocked: boolean;
  isUnconfirmed: boolean;
  suppressImplementationPlan?: boolean;
  onRevert: (stepIndex: number, editText?: string) => void;
  onImageClick: (src: string) => void;
}

const MessageBubble = memo(
  function MessageBubble({
    msg,
    isLocked,
    isUnconfirmed,
    suppressImplementationPlan = false,
    onRevert,
    onImageClick,
  }: MessageBubbleProps) {
    const renderedContent = useMemo(
      () => (msg.content ? renderMarkdown(msg.content) : ""),
      [msg.content],
    );
    const showImplementationPlan =
      Boolean(msg.thinking) && !suppressImplementationPlan;

    if (
      !showImplementationPlan &&
      !msg.content &&
      (!msg.media || msg.media.length === 0)
    ) {
      return null;
    }

    return (
      <div
        className={`message ${msg.role}${isUnconfirmed ? " unconfirmed" : ""}`}
      >
        <div className="chat-block message-body">
          {showImplementationPlan && msg.thinking && (
            <ImplementationPlanBlock
              plan={msg.thinking}
              duration={msg.thinkingDuration}
            />
          )}
          {msg.media && msg.media.length > 0 && (
            <MediaThumbs media={msg.media} onImageClick={onImageClick} />
          )}
          {msg.content && <MarkdownContent html={renderedContent} />}
          {msg.content && (
            <div className="msg-actions">
              {msg.stepIndex >= 0 && (
                <button
                  className={`msg-action-btn ${isLocked ? "locked" : ""}`}
                  onClick={() => {
                    if (!isLocked) {
                      onRevert(
                        msg.stepIndex,
                        msg.role === "user" ? msg.content : undefined,
                      );
                    }
                  }}
                  title="Revert"
                  disabled={isLocked}
                >
                  <IconUndo size={13} />
                </button>
              )}
              <CopyButton text={msg.content} />
            </div>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.msg.content === next.msg.content &&
    prev.msg.thinking === next.msg.thinking &&
    prev.msg.thinkingDuration === next.msg.thinkingDuration &&
    prev.msg.stepIndex === next.msg.stepIndex &&
    prev.msg.role === next.msg.role &&
    prev.msg.media === next.msg.media &&
    prev.isLocked === next.isLocked &&
    prev.isUnconfirmed === next.isUnconfirmed &&
    prev.suppressImplementationPlan === next.suppressImplementationPlan,
);

/** Fullscreen image lightbox with swipe-down-to-dismiss */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const DISMISS_THRESHOLD = 120;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    setDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - startY.current;
    // Only allow downward drag
    setDragY(Math.max(0, dy));
  }, []);

  const handleTouchEnd = useCallback(() => {
    setDragging(false);
    if (dragY > DISMISS_THRESHOLD) {
      onClose();
    } else {
      setDragY(0);
    }
  }, [dragY, onClose]);

  const progress = Math.min(dragY / DISMISS_THRESHOLD, 1);
  const overlayOpacity = 0.9 - progress * 0.5;

  return (
    <div
      className="lightbox-overlay"
      style={{ backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})` }}
      onClick={onClose}
    >
      <img
        src={src}
        className="lightbox-img"
        alt="Expanded"
        style={{
          transform: `translateY(${dragY}px) scale(${1 - progress * 0.1})`,
          transition: dragging ? "none" : "transform 0.25s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  );
}

export function ChatPanel({
  cascadeId,
  onRevert,
  onFilePermission,
  onCommandAction,
  onAskQuestion,
  onConfirmOptimistic,
  optimisticMessages = [],
  refreshKey = 0,
  hardRefreshKey = 0,
  totalStepCount,
  isConversationRunning = false,
  browserNotificationsEnabled = false,
  conversationTitle,
  onSidebarRefresh,
}: Props) {
  const {
    steps: rawSteps,
    loading,
    refresh,
    hardRefresh,
    hasMore,
    loadingOlder,
    loadOlder,
    wsRunning,
  } = useStepsStream(
    cascadeId,
    totalStepCount,
    onSidebarRefresh,
    isConversationRunning,
    browserNotificationsEnabled,
  );

  useChatNotifications({
    cascadeId,
    steps: rawSteps,
    loading,
    wsRunning,
    isConversationRunning,
    enabled: browserNotificationsEnabled,
    conversationTitle,
  });

  const [
    pinnedImplementationPlanStepIndex,
    setPinnedImplementationPlanStepIndex,
  ] = useState<number | null>(null);

  // Soft re-fetch when refreshKey changes (e.g. after send)
  const prevKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== prevKeyRef.current) {
      prevKeyRef.current = refreshKey;
      refresh();
    }
  }, [refreshKey, refresh]);

  // Hard re-fetch when hardRefreshKey changes (e.g. after revert/stop)
  const prevHardKeyRef = useRef(hardRefreshKey);
  useEffect(() => {
    if (hardRefreshKey !== prevHardKeyRef.current) {
      prevHardKeyRef.current = hardRefreshKey;
      hardRefresh();
    }
  }, [hardRefreshKey, hardRefresh]);

  // Reset scroll state when switching chats
  const prevCascadeRef = useRef(cascadeId);
  useEffect(() => {
    if (cascadeId !== prevCascadeRef.current) {
      prevCascadeRef.current = cascadeId;
      didInitialScroll.current = false;
      setPinnedImplementationPlanStepIndex(null);
    }
  }, [cascadeId]);

  const serverMessages = useMemo(() => stepsToMessages(rawSteps), [rawSteps]);
  const liveImplementationPlan = useMemo(
    () => latestImplementationPlan(rawSteps),
    [rawSteps],
  );
  const {
    messages,
    confirmedOptimisticIds,
    hasUnconfirmedOptimistic,
  } = useMemo(
    () => mergeOptimisticMessages(serverMessages, optimisticMessages),
    [serverMessages, optimisticMessages],
  );

  useEffect(() => {
    if (confirmedOptimisticIds.length === 0 || !onConfirmOptimistic) return;
    onConfirmOptimistic(confirmedOptimisticIds);
  }, [confirmedOptimisticIds, onConfirmOptimistic]);

  const isLocked = wsRunning || hasUnconfirmedOptimistic;
  const showTyping = wsRunning || hasUnconfirmedOptimistic;
  const liveImplementationPlanActive =
    showTyping && liveImplementationPlan !== null;
  const pinnedImplementationPlan =
    liveImplementationPlan &&
    (liveImplementationPlanActive ||
      pinnedImplementationPlanStepIndex === liveImplementationPlan.stepIndex)
      ? liveImplementationPlan
      : null;
  const pinnedPlanInsertBeforeMessageIndex = useMemo(() => {
    if (!pinnedImplementationPlan) return -1;
    return messages.findIndex(
      (msg) =>
        msg.role === "assistant" &&
        msg.stepIndex >= pinnedImplementationPlan.stepIndex &&
        Boolean(msg.content.trim()),
    );
  }, [messages, pinnedImplementationPlan]);

  useEffect(() => {
    if (liveImplementationPlanActive && liveImplementationPlan) {
      setPinnedImplementationPlanStepIndex(liveImplementationPlan.stepIndex);
    }
  }, [liveImplementationPlanActive, liveImplementationPlan]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const isNearBottom = useRef(true);
  const showScrollBtnRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const prevMsgCount = useRef(messages.length);
  const suppressScroll = useRef(false);

  // Auto-scroll: on first render (instant) and when new messages arrive while near bottom
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (!didInitialScroll.current && messages.length > 0) {
      // eslint-disable-next-line react-hooks/immutability
      didInitialScroll.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }

    // New messages arrived and user was near the bottom → follow
    if (messages.length > prevMsgCount.current && isNearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  // Lazy load older steps when user scrolls to top
  const loadOlderLock = useRef(false);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || suppressScroll.current) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    // Only trigger re-render when the button visibility actually changes
    const shouldShow = distFromBottom > 200;
    if (shouldShow !== showScrollBtnRef.current) {
      showScrollBtnRef.current = shouldShow;
      setShowScrollBtn(shouldShow);
    }
    isNearBottom.current = distFromBottom < 100;

    // Trigger lazy load when near the top (only after initial scroll-to-bottom)
    if (
      didInitialScroll.current &&
      el.scrollTop < 200 &&
      hasMore &&
      !loadingOlder &&
      !loadOlderLock.current
    ) {
      loadOlderLock.current = true;
      const prevHeight = el.scrollHeight;
      suppressScroll.current = true;
      loadOlder().then((count) => {
        if (count > 0 && scrollRef.current) {
          // Preserve scroll position: offset by the height of prepended content
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              const newHeight = scrollRef.current.scrollHeight;
              scrollRef.current.scrollTop += newHeight - prevHeight;
            }
            // Allow one more frame for the browser to settle before re-enabling
            requestAnimationFrame(() => {
              suppressScroll.current = false;
              loadOlderLock.current = false;
            });
          });
        } else {
          suppressScroll.current = false;
          loadOlderLock.current = false;
        }
      });
    }
  }, [hasMore, loadingOlder, loadOlder]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const innerRef = useRef<HTMLDivElement>(null);

  // Prevent infinite retry of broken images rendered from markdown.
  // When an <img> 404s, mark it so subsequent re-renders don't re-request it.
  const failedImages = useRef<Set<string>>(new Set());
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const imgs = el.querySelectorAll<HTMLImageElement>(
      ".message-body img:not([data-failed])",
    );
    imgs.forEach((img) => {
      // If this src already failed, kill it immediately
      if (failedImages.current.has(img.src)) {
        img.dataset.failed = "1";
        img.removeAttribute("src");
        img.alt = "⚠ Image not found";
        return;
      }
      img.addEventListener(
        "error",
        () => {
          failedImages.current.add(img.src);
          img.dataset.failed = "1";
          img.removeAttribute("src");
          img.alt = "⚠ Image not found";
        },
        { once: true },
      );
    });
  });

  // Open lightbox when clicking markdown-rendered <img> in message bodies.
  // Uses React onClick (synthetic event delegation) so it survives dangerouslySetInnerHTML DOM replacement.
  const handleImgClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "IMG" &&
      target.closest(".message-body") &&
      !target.hasAttribute("data-failed")
    ) {
      e.preventDefault();
      setLightboxSrc((target as HTMLImageElement).src);
    }
  }, []);

  if (loading && messages.length === 0) {
    return (
      <div className="chat-area">
        <div className="chat-empty">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-area">
        <div className="chat-empty">
          <div className="chat-empty-icon">
            <IconMessageCircle size={48} />
          </div>
          <div className="chat-empty-text">No messages yet</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat-area"
      ref={scrollRef}
      onScroll={handleScroll}
      onTouchMove={() => {
        // Dismiss iOS keyboard when scrolling chat area
        const el = document.activeElement;
        if (
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLInputElement
        ) {
          el.blur();
        }
      }}
    >
      <div className="chat-area-inner" ref={innerRef} onClick={handleImgClick}>
        {loadingOlder && (
          <div className="loading-older">
            <div className="loading-spinner" />
          </div>
        )}

        {messages.map((msg, i) => {
          const messageKey = msg.optimisticId ?? `${msg.stepIndex}-${i}`;
          const pinnedPlanNode =
            pinnedImplementationPlan &&
            i === pinnedPlanInsertBeforeMessageIndex ? (
              <PinnedImplementationPlanMessage
                implementationPlan={pinnedImplementationPlan}
                live={liveImplementationPlanActive}
              />
            ) : null;

          if (msg.role === "system") {
            return (
              <Fragment key={messageKey}>
                {pinnedPlanNode}
                <SystemMessage
                  msg={msg}
                  onFilePermission={onFilePermission}
                  onCommandAction={onCommandAction}
                  onAskQuestion={onAskQuestion}
                />
              </Fragment>
            );
          }

          return (
            <Fragment key={messageKey}>
              {pinnedPlanNode}
              <MessageBubble
                msg={msg}
                isLocked={isLocked}
                isUnconfirmed={isUnconfirmedOptimisticMessage(msg)}
                suppressImplementationPlan={
                  pinnedImplementationPlan?.stepIndex === msg.stepIndex
                }
                onRevert={onRevert}
                onImageClick={setLightboxSrc}
              />
            </Fragment>
          );
        })}
        {pinnedImplementationPlan && pinnedPlanInsertBeforeMessageIndex < 0 && (
          <PinnedImplementationPlanMessage
            implementationPlan={pinnedImplementationPlan}
            live={liveImplementationPlanActive}
          />
        )}
        {showTyping && (
          <div className="message assistant">
            <div className="message-body">
              <div className="typing-indicator">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
      </div>
      {showScrollBtn && (
        <button
          className="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          ↓
        </button>
      )}
      {lightboxSrc &&
        createPortal(
          <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />,
          document.body,
        )}
    </div>
  );
}
