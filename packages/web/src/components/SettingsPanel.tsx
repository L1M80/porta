/**
 * Settings panel — global client configuration.
 *
 * Currently supports:
 *   - Default model selection
 *   - Default planner type (Fast / Plan)
 *
 * Settings are stored client-side in localStorage.
 */

import { useState, useEffect, useCallback } from "react";
import { IconChevronLeft, IconCheck } from "./Icons";
import { api } from "../api/client";
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "../utils/browserNotifications";
import type { ClientSettings } from "../types";
import type { PlannerType } from "./ChatInput";

interface ModelConfig {
  label: string;
  modelOrAlias: { model: string };
  supportsImages: boolean;
  isRecommended: boolean;
  quotaInfo?: { remainingFraction: number };
}

interface Props {
  settings: ClientSettings;
  onUpdate: (patch: Partial<ClientSettings>) => void;
  onBack: () => void;
}

export function SettingsPanel({ settings, onUpdate, onBack }: Props) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [fetchError, setFetchError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(
      getBrowserNotificationPermission,
    );

  const fetchModels = useCallback(async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await api.models();
        setModels(data.clientModelConfigs ?? []);
        setFetchError(false);
        return;
      } catch {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }
    setFetchError(true);
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    const syncPermission = () => {
      setNotificationPermission(getBrowserNotificationPermission());
    };

    window.addEventListener("focus", syncPermission);
    return () => window.removeEventListener("focus", syncPermission);
  }, []);

  useEffect(() => {
    if (
      settings.browserNotificationsEnabled &&
      notificationPermission !== "granted"
    ) {
      onUpdate({ browserNotificationsEnabled: false });
    }
  }, [notificationPermission, onUpdate, settings.browserNotificationsEnabled]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleModelChange = useCallback(
    (modelId: string) => {
      const value = modelId === "__none__" ? null : modelId;
      onUpdate({ defaultModel: value });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handlePlannerChange = useCallback(
    (value: string) => {
      onUpdate({ defaultPlannerType: value as PlannerType });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handleNotificationsChange = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        onUpdate({ browserNotificationsEnabled: false });
        flashSaved();
        return;
      }

      const permission = await requestBrowserNotificationPermission();
      setNotificationPermission(permission);
      onUpdate({ browserNotificationsEnabled: permission === "granted" });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handleReset = useCallback(() => {
    onUpdate({
      defaultModel: null,
      defaultPlannerType: "conversational",
      browserNotificationsEnabled: false,
    });
    flashSaved();
  }, [onUpdate, flashSaved]);

  const notificationsChecked =
    settings.browserNotificationsEnabled &&
    notificationPermission === "granted";
  const notificationsDisabled = notificationPermission === "unsupported";
  const notificationStatus =
    notificationPermission === "unsupported"
      ? "Unsupported"
      : notificationPermission === "denied"
        ? "Blocked"
        : notificationsChecked
          ? "On"
          : "Off";

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <button
          className="settings-back-btn"
          onClick={onBack}
          title="Back to chat"
        >
          <IconChevronLeft size={18} />
        </button>
        <h1 className="settings-title">Settings</h1>
        <span className={`settings-saved-badge ${savedFlash ? "visible" : ""}`}>
          <IconCheck size={12} /> Saved
        </span>
      </div>

      <div className="settings-body">
        {/* ── Model ── */}
        <div className="settings-section">
          <h2 className="settings-section-title">Model</h2>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Default Model</span>
              <span className="settings-row-desc">
                The model used when you haven't explicitly selected one
                per-message. Changes apply to new messages only.
              </span>
            </div>
            <select
              className="settings-select"
              value={settings.defaultModel ?? "__none__"}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              <option value="__none__">Server default</option>
              {fetchError && (
                <option disabled>⚠ Failed to load models</option>
              )}
              {models.map((m) => (
                <option key={m.modelOrAlias.model} value={m.modelOrAlias.model}>
                  {m.label}
                  {m.supportsImages ? " [Vision]" : ""}
                  {m.isRecommended ? " (Recommended)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Planner ── */}
        <div className="settings-section">
          <h2 className="settings-section-title">Planner</h2>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Default Mode</span>
              <span className="settings-row-desc">
                Fast gives direct single-step responses. Plan uses a
                multi-step structured approach for complex tasks.
              </span>
            </div>
            <select
              className="settings-select"
              value={settings.defaultPlannerType}
              onChange={(e) => handlePlannerChange(e.target.value)}
            >
              <option value="conversational">Fast</option>
              <option value="planning">Plan</option>
            </select>
          </div>
        </div>

        {/* Notifications */}
        <div className="settings-section">
          <h2 className="settings-section-title">Notifications</h2>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Browser Notifications</span>
              <span className="settings-row-desc">
                Run completion and approval requests.
              </span>
            </div>
            <div className="settings-notification-control">
              <span className="settings-permission-status">
                {notificationStatus}
              </span>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={notificationsChecked}
                  disabled={notificationsDisabled}
                  onChange={(e) => {
                    void handleNotificationsChange(e.target.checked);
                  }}
                  aria-label="Browser Notifications"
                />
                <span className="settings-switch-track" />
              </label>
            </div>
          </div>
        </div>

        {/* ── System Diagnostics ── */}
        <DiagnosticsSection />

        {/* ── Reset ── */}
        <button className="settings-reset-btn" onClick={handleReset}>
          Reset all settings to defaults
        </button>
      </div>
    </div>
  );
}

function DiagnosticsSection() {
  const [diagData, setDiagData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.diagnostics();
      setDiagData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  const lsList = (diagData?.languageServers as Array<Record<string, unknown>>) ?? [];
  const rpcStats = (diagData?.rpcStats as Record<string, unknown>) ?? {};
  const recentErrors = (rpcStats?.recentErrors as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="settings-section-title">System Diagnostics</h2>
        <button
          className="settings-reset-btn"
          style={{ margin: 0, padding: "4px 10px", fontSize: "12px" }}
          onClick={loadDiagnostics}
          disabled={loading}
        >
          {loading ? "Checking..." : "Refresh"}
        </button>
      </div>
      <div className="settings-row-info" style={{ marginBottom: "12px" }}>
        <span className="settings-row-desc">
          Live connection status between Porta proxy and local Antigravity Language Servers.
        </span>
      </div>

      {error && (
        <div style={{ color: "var(--color-danger, #ef4444)", fontSize: "13px", marginBottom: "8px" }}>
          ⚠ Diagnostics fetch error: {error}
        </div>
      )}

      {diagData && (
        <div style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", gap: "16px", background: "var(--bg-card, rgba(255,255,255,0.05))", padding: "8px 12px", borderRadius: "6px" }}>
            <div><strong>Proxy Port:</strong> {String((diagData.proxy as Record<string, unknown>)?.port ?? "3170")}</div>
            <div><strong>Total Requests:</strong> {String(rpcStats.totalRequests ?? 0)}</div>
            <div><strong>Failures:</strong> {String(rpcStats.totalFailures ?? 0)}</div>
          </div>

          <div>
            <strong>Language Servers ({lsList.length}):</strong>
            {lsList.length === 0 ? (
              <div style={{ color: "var(--color-warning, #f59e0b)", marginTop: "4px" }}>
                ⚠ No active Language Servers discovered. Ensure Antigravity is running.
              </div>
            ) : (
              <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "4px" }}>
                {lsList.map((ls, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      background: ls.reachable ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                      border: `1px solid ${ls.reachable ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>
                      {ls.reachable ? "🟢" : "🔴"} Port {String(ls.httpsPort)} (PID {String(ls.pid)})
                    </span>
                    <span>
                      {ls.reachable ? `${String(ls.latencyMs)} ms` : String(ls.error ?? "Unreachable")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {recentErrors.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <strong style={{ color: "var(--color-danger, #ef4444)" }}>Recent RPC Errors ({recentErrors.length}):</strong>
              <div style={{ maxHeight: "120px", overflowY: "auto", marginTop: "4px", display: "flex", flexDirection: "column", gap: "4px" }}>
                {recentErrors.map((err, idx) => (
                  <div key={idx} style={{ background: "rgba(239, 68, 68, 0.08)", padding: "6px", borderRadius: "4px", fontSize: "11px" }}>
                    <div><strong>[{String(err.code)}] {String(err.method)}</strong> <span style={{ opacity: 0.7 }}>({String(err.timestamp)})</span></div>
                    <div style={{ opacity: 0.9 }}>{String(err.message)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
