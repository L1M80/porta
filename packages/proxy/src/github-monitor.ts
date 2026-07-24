/**
 * GitHub Event Monitor for Porta Proxy
 *
 * Tracks GitHub PRs per conversation session, monitors CI checks and Reviews
 * asynchronously via Polling and Webhooks, and injects notifications into
 * the Antigravity agent session when status transitions occur.
 */

import { execSync } from "node:child_process";
import { rpcForConversation } from "./routing.js";
import { getMetadata } from "./metadata.js";
import { conversationSignals } from "./signals.js";

export interface CICheck {
  name: string;
  status: string;
  conclusion?: string;
  targetUrl?: string;
}

export interface TrackedPR {
  id: string; // "owner/repo#pullNumber"
  conversationId: string;
  owner: string;
  repo: string;
  pullNumber: number;
  url: string;
  title?: string;
  headSha?: string;
  lastCiStatus?: "pending" | "success" | "failure" | "unknown";
  lastCiChecks?: CICheck[];
  lastReviewState?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | "NONE";
  lastReviewCommentCount?: number;
  trackedAt: number;
  updatedAt: number;
  autoInject?: boolean;
}

const GITHUB_PR_REGEX =
  /(?:https?:\/\/)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)/gi;

export function parseGitHubPRUrls(
  text: string,
): { owner: string; repo: string; pullNumber: number; url: string }[] {
  const results: { owner: string; repo: string; pullNumber: number; url: string }[] = [];
  const matches = text.matchAll(GITHUB_PR_REGEX);
  for (const match of matches) {
    const [, owner, repo, pullStr] = match;
    const pullNumber = parseInt(pullStr, 10);
    if (owner && repo && !isNaN(pullNumber)) {
      const cleanRepo = repo.replace(/\.git$/, "");
      const url = `https://github.com/${owner}/${cleanRepo}/pull/${pullNumber}`;
      if (!results.some((r) => r.owner === owner && r.repo === cleanRepo && r.pullNumber === pullNumber)) {
        results.push({ owner, repo: cleanRepo, pullNumber, url });
      }
    }
  }
  return results;
}

function getGitHubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

  try {
    const token = execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (token) return token;
  } catch {
    // gh CLI token not available
  }
  return undefined;
}

export class GitHubMonitor {
  private trackedPRs = new Map<string, TrackedPR>(); // key: `${conversationId}:${owner}/${repo}#${pullNumber}`
  private pollInterval?: ReturnType<typeof setInterval>;
  private token?: string;
  private listeners: ((event: { type: string; pr: TrackedPR }) => void)[] = [];

  constructor() {
    this.token = getGitHubToken();
  }

  public onEvent(listener: (event: { type: string; pr: TrackedPR }) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(type: string, pr: TrackedPR) {
    for (const listener of this.listeners) {
      try {
        listener({ type, pr });
      } catch (err) {
        console.error("[github-monitor] Listener error:", err);
      }
    }
  }

  public trackPR(
    conversationId: string,
    owner: string,
    repo: string,
    pullNumber: number,
    autoInject = true,
  ): TrackedPR {
    const key = `${conversationId}:${owner}/${repo}#${pullNumber}`;
    const existing = this.trackedPRs.get(key);
    if (existing) return existing;

    const pr: TrackedPR = {
      id: `${owner}/${repo}#${pullNumber}`,
      conversationId,
      owner,
      repo,
      pullNumber,
      url: `https://github.com/${owner}/${repo}/pull/${pullNumber}`,
      trackedAt: Date.now(),
      updatedAt: Date.now(),
      autoInject,
    };

    this.trackedPRs.set(key, pr);
    console.log(`[github-monitor] Tracking PR ${pr.id} for conversation ${conversationId}`);
    
    // Initial fetch async
    void this.checkPRStatus(pr);

    return pr;
  }

  public untrackPR(conversationId: string, owner: string, repo: string, pullNumber: number): boolean {
    const key = `${conversationId}:${owner}/${repo}#${pullNumber}`;
    const deleted = this.trackedPRs.delete(key);
    if (deleted) {
      console.log(`[github-monitor] Untracked PR ${owner}/${repo}#${pullNumber} for conversation ${conversationId}`);
    }
    return deleted;
  }

  public getTrackedPRs(conversationId?: string): TrackedPR[] {
    const all = Array.from(this.trackedPRs.values());
    if (!conversationId) return all;
    return all.filter((pr) => pr.conversationId === conversationId);
  }

  private async fetchGitHubAPI(path: string): Promise<any> {
    const headers: Record<string, string> = {
      "User-Agent": "Porta-Proxy-GitHub-Monitor",
      Accept: "application/vnd.github.v3+json",
    };
    const token = this.token || getGitHubToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  }

  public async checkPRStatus(pr: TrackedPR): Promise<TrackedPR> {
    const key = `${pr.conversationId}:${pr.owner}/${pr.repo}#${pr.pullNumber}`;
    const current = this.trackedPRs.get(key) || pr;

    try {
      // 1. Fetch PR metadata
      const prData = await this.fetchGitHubAPI(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.pullNumber}`);
      const headSha = prData.head?.sha;
      const title = prData.title;

      // 2. Fetch CI Check Runs
      let ciStatus: "pending" | "success" | "failure" | "unknown" = "unknown";
      let ciChecks: CICheck[] = [];

      if (headSha) {
        try {
          const checksData = await this.fetchGitHubAPI(
            `/repos/${pr.owner}/${pr.repo}/commits/${headSha}/check-runs`,
          );
          if (Array.isArray(checksData.check_runs)) {
            ciChecks = checksData.check_runs.map((cr: any) => ({
              name: cr.name,
              status: cr.status,
              conclusion: cr.conclusion || undefined,
              targetUrl: cr.html_url,
            }));

            const anyInProgress = ciChecks.some((c) => c.status !== "completed");
            const anyFailed = ciChecks.some((c) =>
              ["failure", "timed_out", "action_required", "cancelled"].includes(c.conclusion || ""),
            );

            if (anyFailed) {
              ciStatus = "failure";
            } else if (anyInProgress) {
              ciStatus = "pending";
            } else if (ciChecks.length > 0) {
              ciStatus = "success";
            }
          }
        } catch (ciErr) {
          console.warn(`[github-monitor] Error fetching check runs for ${pr.id}:`, ciErr);
        }
      }

      // 3. Fetch Reviews
      let reviewState: TrackedPR["lastReviewState"] = "NONE";
      let reviewCommentCount = 0;
      try {
        const reviews = await this.fetchGitHubAPI(
          `/repos/${pr.owner}/${pr.repo}/pulls/${pr.pullNumber}/reviews`,
        );
        if (Array.isArray(reviews) && reviews.length > 0) {
          reviewCommentCount = reviews.length;
          const latestReview = reviews[reviews.length - 1];
          reviewState = latestReview.state as TrackedPR["lastReviewState"];
        }
      } catch (revErr) {
        console.warn(`[github-monitor] Error fetching reviews for ${pr.id}:`, revErr);
      }

      // Detect transitions
      const prevCiStatus = current.lastCiStatus;
      const prevReviewState = current.lastReviewState;
      const prevCommentCount = current.lastReviewCommentCount || 0;

      const updatedPR: TrackedPR = {
        ...current,
        title,
        headSha,
        lastCiStatus: ciStatus,
        lastCiChecks: ciChecks,
        lastReviewState: reviewState,
        lastReviewCommentCount: reviewCommentCount,
        updatedAt: Date.now(),
      };

      this.trackedPRs.set(key, updatedPR);

      // Trigger Notifications / Agent Messages on Transition
      if (prevCiStatus && prevCiStatus !== ciStatus) {
        this.notifyListeners("ci_change", updatedPR);

        if (updatedPR.autoInject) {
          if (ciStatus === "failure") {
            const failedNames = ciChecks
              .filter((c) => ["failure", "timed_out", "action_required"].includes(c.conclusion || ""))
              .map((c) => c.name)
              .join(", ");

            void this.injectAgentNotification(
              updatedPR.conversationId,
              `[GitHub CI Alert] CI build/checks failed for PR #${updatedPR.pullNumber} (${updatedPR.owner}/${updatedPR.repo}).\nFailed checks: ${failedNames || "Unknown"}\nPR URL: ${updatedPR.url}`,
            );
          } else if (ciStatus === "success") {
            void this.injectAgentNotification(
              updatedPR.conversationId,
              `[GitHub CI Notification] All CI checks passed for PR #${updatedPR.pullNumber} (${updatedPR.owner}/${updatedPR.repo}).\nPR URL: ${updatedPR.url}`,
            );
          }
        }
      }

      if (
        (prevReviewState && prevReviewState !== reviewState) ||
        reviewCommentCount > prevCommentCount
      ) {
        this.notifyListeners("review_change", updatedPR);

        if (updatedPR.autoInject && reviewState && reviewState !== "NONE") {
          void this.injectAgentNotification(
            updatedPR.conversationId,
            `[GitHub Review Alert] New review activity on PR #${updatedPR.pullNumber} (${updatedPR.owner}/${updatedPR.repo}).\nStatus: ${reviewState}\nPR URL: ${updatedPR.url}`,
          );
        }
      }

      return updatedPR;
    } catch (err) {
      console.warn(`[github-monitor] Check failed for ${pr.id}:`, err);
      return current;
    }
  }

  public async injectAgentNotification(conversationId: string, promptText: string): Promise<void> {
    try {
      console.log(`[github-monitor] Injecting agent notification into session ${conversationId}...`);
      const metadata = await getMetadata(true);
      await rpcForConversation("SendUserCascadeMessage", conversationId, {
        metadata,
        cascadeId: conversationId,
        items: [{ text: promptText }],
        cascadeConfig: {
          plannerConfig: {
            plannerTypeConfig: { conversational: {} },
          },
        },
      });
      conversationSignals.emit("activate", conversationId);
    } catch (err) {
      console.error(`[github-monitor] Failed to inject notification into ${conversationId}:`, err);
    }
  }

  public async processWebhook(payload: any, eventName: string): Promise<void> {
    console.log(`[github-monitor] Received Webhook event '${eventName}'`);

    let owner: string | undefined;
    let repo: string | undefined;
    let pullNumber: number | undefined;

    if (payload.repository) {
      owner = payload.repository.owner?.login;
      repo = payload.repository.name;
    }

    if (payload.pull_request) {
      pullNumber = payload.pull_request.number;
    } else if (payload.check_run?.check_suite?.pull_requests?.[0]) {
      pullNumber = payload.check_run.check_suite.pull_requests[0].number;
    }

    if (owner && repo && pullNumber) {
      const targetPRs = Array.from(this.trackedPRs.values()).filter(
        (p) => p.owner === owner && p.repo === repo && p.pullNumber === pullNumber,
      );

      for (const pr of targetPRs) {
        await this.checkPRStatus(pr);
      }
    }
  }

  public async pollAll(): Promise<void> {
    const prs = Array.from(this.trackedPRs.values());
    if (prs.length === 0) return;

    for (const pr of prs) {
      await this.checkPRStatus(pr);
    }
  }

  public startPolling(intervalMs = 30_000): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => {
      void this.pollAll();
    }, intervalMs);
    console.log(`[github-monitor] Polling started (interval: ${intervalMs}ms)`);
  }

  public stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
      console.log("[github-monitor] Polling stopped");
    }
  }
}

export const githubMonitor = new GitHubMonitor();
