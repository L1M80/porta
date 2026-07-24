import { IconMenu, IconFolder, IconSettings } from "./Icons";
import { GitHubPrBadge } from "./GitHubPrBadge";
import type { ChatSettings } from "../types";

interface Props {
  title: string;
  projectName?: string;
  cascadeId?: string;
  onMenuToggle?: () => void;
  chatSettings?: ChatSettings;
  onOpenChatSettings?: () => void;
}

export function ChatHeader({
  title,
  projectName,
  cascadeId,
  onMenuToggle,
  chatSettings,
  onOpenChatSettings,
}: Props) {
  const hasAutoExecutables =
    chatSettings &&
    (chatSettings.autoApproveAllCommands ||
      (chatSettings.autoApprovedExecutables &&
        chatSettings.autoApprovedExecutables.length > 0));

  const autoLabel = chatSettings?.autoApproveAllCommands
    ? "All commands"
    : chatSettings?.autoApprovedExecutables?.join(", ");

  return (
    <div className="main-header">
      {onMenuToggle && (
        <button
          className="mobile-menu-btn"
          onClick={onMenuToggle}
          title="Open menu"
        >
          <IconMenu size={18} />
        </button>
      )}
      <span
        className="main-header-title"
        onClick={() => {
          document
            .querySelector(".chat-area")
            ?.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        {title}
      </span>
      <div className="main-header-actions">
        {onOpenChatSettings && (
          <button
            type="button"
            className={`header-chat-settings-btn ${hasAutoExecutables ? "has-auto" : ""}`}
            onClick={onOpenChatSettings}
            title={
              hasAutoExecutables
                ? `Auto-approving: ${autoLabel}`
                : "Configure per-chat auto-approval"
            }
          >
            <IconSettings size={13} />
            {hasAutoExecutables && (
              <span className="auto-approve-badge-text">
                Auto: {autoLabel}
              </span>
            )}
          </button>
        )}
        {cascadeId && <GitHubPrBadge cascadeId={cascadeId} />}
        {projectName && (
          <span className="main-header-project">
            <IconFolder size={11} /> {projectName}
          </span>
        )}
      </div>
    </div>
  );
}
