/**
 * GitHub Event Monitor API Routes
 */

import type { Hono } from "hono";
import { githubMonitor, parseGitHubPRUrls } from "../github-monitor.js";

export function registerGithubRoutes(app: Hono): void {
  // Track PR(s) for a conversation
  app.post("/api/conversations/:id/github/track", async (c) => {
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const { url, owner, repo, pullNumber, text, autoInject } = body;

      const tracked = [];

      if (url) {
        const parsed = parseGitHubPRUrls(url);
        for (const item of parsed) {
          const pr = githubMonitor.trackPR(
            id,
            item.owner,
            item.repo,
            item.pullNumber,
            autoInject ?? true,
          );
          tracked.push(pr);
        }
      } else if (owner && repo && pullNumber) {
        const pr = githubMonitor.trackPR(
          id,
          owner,
          repo,
          Number(pullNumber),
          autoInject ?? true,
        );
        tracked.push(pr);
      } else if (text) {
        const parsed = parseGitHubPRUrls(text);
        for (const item of parsed) {
          const pr = githubMonitor.trackPR(
            id,
            item.owner,
            item.repo,
            item.pullNumber,
            autoInject ?? true,
          );
          tracked.push(pr);
        }
      }

      return c.json({ ok: true, tracked }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Get tracked PRs and status for a conversation
  app.get("/api/conversations/:id/github/prs", (c) => {
    const id = c.req.param("id");
    const prs = githubMonitor.getTrackedPRs(id);
    return c.json({ prs });
  });

  // Untrack a PR
  app.delete("/api/conversations/:id/github/prs/:owner/:repo/:pullNumber", (c) => {
    const id = c.req.param("id");
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const pullNumber = parseInt(c.req.param("pullNumber"), 10);

    const deleted = githubMonitor.untrackPR(id, owner, repo, pullNumber);
    return c.json({ ok: deleted });
  });

  // Webhook Receiver
  app.post("/api/github/webhook", async (c) => {
    try {
      const eventName = c.req.header("x-github-event") || "unknown";
      const payload = await c.req.json();
      await githubMonitor.processWebhook(payload, eventName);
      return c.json({ status: "received", event: eventName });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
}
