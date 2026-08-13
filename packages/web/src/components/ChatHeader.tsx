import { IconMenu, IconFolder } from "./Icons";
import { AppTargetSelector } from "./AppTargetSelector";
import type { TargetApp } from "../types";

interface Props {
  title: string;
  projectName?: string;
  targetApp?: TargetApp;
  onTargetAppChange?: (app: TargetApp) => void;
  onMenuToggle?: () => void;
}

export function ChatHeader({
  title,
  projectName,
  targetApp,
  onTargetAppChange,
  onMenuToggle,
}: Props) {
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
        {targetApp && onTargetAppChange && (
          <AppTargetSelector
            value={targetApp}
            onChange={onTargetAppChange}
          />
        )}
        {projectName && (
          <span className="main-header-project">
            <IconFolder size={11} /> {projectName}
          </span>
        )}
      </div>
    </div>
  );
}
