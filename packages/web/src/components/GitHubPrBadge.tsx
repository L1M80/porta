import { useState, useEffect } from "react";
import { api } from "../api/client";

interface TrackedPR {
  id: string; // owner/repo#number
  owner: string;
  repo: string;
  pullNumber: number;
  url: string;
  title?: string;
  lastCiStatus?: "pending" | "success" | "failure" | "unknown";
  lastReviewState?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | "NONE";
}

interface Props {
  cascadeId: string;
}

export function GitHubPrBadge({ cascadeId }: Props) {
  const [prs, setPrs] = useState<TrackedPR[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchPRs = async () => {
    try {
      const data = await api.getTrackedPRs(cascadeId);
      setPrs(data.prs || []);
    } catch {
      // Ignore errors
    }
  };

  useEffect(() => {
    void fetchPRs();
    const interval = setInterval(() => {
      void fetchPRs();
    }, 10_000);
    return () => clearInterval(interval);
  }, [cascadeId]);

  const handleAddPR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setLoading(true);
    try {
      await api.trackPR(cascadeId, newUrl.trim());
      setNewUrl("");
      await fetchPRs();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePR = async (owner: string, repo: string, pullNumber: number) => {
    try {
      await api.untrackPR(cascadeId, owner, repo, pullNumber);
      await fetchPRs();
    } catch (err) {
      console.error("Failed to untrack PR", err);
    }
  };

  const getCiIcon = (status?: string) => {
    if (status === "success") return "✅";
    if (status === "failure") return "❌";
    if (status === "pending") return "⏳";
    return "⚪";
  };

  const getReviewIcon = (state?: string) => {
    if (state === "APPROVED") return "👍";
    if (state === "CHANGES_REQUESTED") return "⚠️";
    if (state === "COMMENTED") return "💬";
    return "";
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: prs.length > 0 ? "#1e293b" : "transparent",
          border: "1px solid #334155",
          borderRadius: "6px",
          color: "#e2e8f0",
          padding: "4px 8px",
          fontSize: "12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
        title="GitHub PR Monitoring"
      >
        <span>🐙 PRs ({prs.length})</span>
        {prs.length > 0 && (
          <span style={{ fontSize: "11px" }}>
            {getCiIcon(prs[0].lastCiStatus)} {getReviewIcon(prs[0].lastReviewState)}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "6px",
            width: "300px",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: "8px",
            padding: "12px",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)",
            zIndex: 100,
            color: "#f8fafc",
            fontSize: "13px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
            <span>Tracked GitHub PRs</span>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleAddPR} style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            <input
              type="text"
              placeholder="Paste PR URL..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid #334155",
                background: "#1e293b",
                color: "#fff",
                fontSize: "12px",
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "6px 10px",
                borderRadius: "4px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Track
            </button>
          </form>

          {prs.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: "12px", textAlign: "center", padding: "8px 0" }}>
              No PRs tracked yet for this chat.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "200px", overflowY: "auto" }}>
              {prs.map((pr) => (
                <div
                  key={pr.id}
                  style={{
                    background: "#1e293b",
                    padding: "8px",
                    borderRadius: "6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#38bdf8", fontWeight: 500, textDecoration: "none" }}
                    >
                      {pr.owner}/{pr.repo}#{pr.pullNumber}
                    </a>
                    <button
                      onClick={() => handleRemovePR(pr.owner, pr.repo, pr.pullNumber)}
                      style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "11px" }}
                    >
                      Remove
                    </button>
                  </div>
                  {pr.title && <div style={{ fontSize: "11px", color: "#cbd5e1" }}>{pr.title}</div>}
                  <div style={{ fontSize: "11px", display: "flex", gap: "10px", color: "#94a3b8" }}>
                    <span>CI: {getCiIcon(pr.lastCiStatus)} {pr.lastCiStatus || "unknown"}</span>
                    {pr.lastReviewState && pr.lastReviewState !== "NONE" && (
                      <span>Review: {getReviewIcon(pr.lastReviewState)} {pr.lastReviewState}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
