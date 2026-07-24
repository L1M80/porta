import { IconMenu, IconFolder } from "./Icons";
import { GitHubPrBadge } from "./GitHubPrBadge";

interface Props {
  title: string;
  projectName?: string;
  cascadeId?: string;
  onMenuToggle?: () => void;
}

export function ChatHeader({ title, projectName, cascadeId, onMenuToggle }: Props) {
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
