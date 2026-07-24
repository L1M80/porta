import React, { useState } from "react";
import type { ChatSettings } from "../types";
import { IconCheck } from "./Icons";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cascadeId: string;
  chatTitle?: string;
  settings: ChatSettings;
  onUpdateSettings: (patch: Partial<ChatSettings>) => Promise<void>;
}

const COMMON_PRESETS = ["git", "node", "pnpm", "npm", "bun", "python", "cargo", "docker", "deno"];

export function ChatSettingsModal({
  isOpen,
  onClose,
  cascadeId: _cascadeId,
  chatTitle,
  settings,
  onUpdateSettings,
}: Props) {
  const [customExe, setCustomExe] = useState("");
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const currentExecutables = settings.autoApprovedExecutables ?? [];

  const handleToggleExecutable = async (exe: string) => {
    const normalized = exe.toLowerCase().trim();
    if (!normalized) return;

    let updated: string[];
    if (currentExecutables.includes(normalized)) {
      updated = currentExecutables.filter((e) => e !== normalized);
    } else {
      updated = [...currentExecutables, normalized];
    }

    setSaving(true);
    try {
      await onUpdateSettings({ autoApprovedExecutables: updated });
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustom = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const normalized = customExe.toLowerCase().trim();
    if (!normalized) return;

    if (!currentExecutables.includes(normalized)) {
      setSaving(true);
      try {
        await onUpdateSettings({
          autoApprovedExecutables: [...currentExecutables, normalized],
        });
        setCustomExe("");
      } finally {
        setSaving(false);
      }
    } else {
      setCustomExe("");
    }
  };

  const handleToggleApproveAll = async (checked: boolean) => {
    setSaving(true);
    try {
      await onUpdateSettings({ autoApproveAllCommands: checked });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content chat-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>Chat Settings</h3>
            {chatTitle && <span className="modal-subtitle">{chatTitle}</span>}
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close settings">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="settings-section">
            <h4 className="settings-section-title">Terminal Command Auto-Approval</h4>
            <p className="settings-section-desc">
              When Antigravity requests command execution (e.g. <code>git</code>, <code>node</code>, <code>pnpm</code>),
              commands matching allowed executables will be auto-approved directly for this chat.
            </p>

            <div className="settings-field">
              <label className="field-label">Allowed Executables</label>
              <div className="exe-tags-container">
                {currentExecutables.length === 0 ? (
                  <span className="no-exe-text">No executables configured yet. Select a preset or type one below.</span>
                ) : (
                  currentExecutables.map((exe) => (
                    <span key={exe} className="exe-tag">
                      <code>{exe}</code>
                      <button
                        type="button"
                        className="exe-remove-btn"
                        onClick={() => handleToggleExecutable(exe)}
                        title={`Remove ${exe}`}
                        disabled={saving}
                      >
                        ✕
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="settings-field">
              <label className="field-label">Quick Add Presets</label>
              <div className="presets-chips">
                {COMMON_PRESETS.map((preset) => {
                  const isAdded = currentExecutables.includes(preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      className={`preset-chip ${isAdded ? "active" : ""}`}
                      onClick={() => handleToggleExecutable(preset)}
                      disabled={saving}
                    >
                      {isAdded ? <IconCheck size={11} /> : "+"} {preset}
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={handleAddCustom} className="settings-field custom-exe-form">
              <label className="field-label">Add Custom Executable</label>
              <div className="custom-exe-input-group">
                <input
                  type="text"
                  className="settings-input"
                  placeholder="Executable name (e.g., make, kubectl, cargo)"
                  value={customExe}
                  onChange={(e) => setCustomExe(e.target.value)}
                  disabled={saving}
                />
                <button
                  type="submit"
                  className="settings-add-btn"
                  disabled={!customExe.trim() || saving}
                >
                  Add
                </button>
              </div>
            </form>

            <div className="settings-row approve-all-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Auto-approve ALL commands</span>
                <span className="settings-row-desc">
                  Automatically approve any terminal command requested by Antigravity in this chat.
                </span>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={settings.autoApproveAllCommands}
                  onChange={(e) => handleToggleApproveAll(e.target.checked)}
                  disabled={saving}
                />
                <span className="settings-switch-track" />
              </label>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="settings-done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
