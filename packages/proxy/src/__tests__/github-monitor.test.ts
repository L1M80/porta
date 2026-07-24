import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { GitHubMonitor, parseGitHubPRUrls } from "../github-monitor.js";
import { registerGithubRoutes } from "../routes/github.js";

describe("parseGitHubPRUrls", () => {
  it("extracts GitHub PR URLs from plain text and markdown", () => {
    const sampleText = `
      Please check PR https://github.com/L1M80/porta/pull/123 for details.
      Also see github.com/owner/repo/pull/456.git and random text.
    `;

    const prs = parseGitHubPRUrls(sampleText);
    expect(prs).toHaveLength(2);
    expect(prs[0]).toEqual({
      owner: "L1M80",
      repo: "porta",
      pullNumber: 123,
      url: "https://github.com/L1M80/porta/pull/123",
    });
    expect(prs[1]).toEqual({
      owner: "owner",
      repo: "repo",
      pullNumber: 456,
      url: "https://github.com/owner/repo/pull/456",
    });
  });

  it("deduplicates identical PR URLs", () => {
    const text = `
      https://github.com/org/repo/pull/999
      https://github.com/org/repo/pull/999
    `;
    const prs = parseGitHubPRUrls(text);
    expect(prs).toHaveLength(1);
  });
});

describe("GitHubMonitor", () => {
  let monitor: GitHubMonitor;

  beforeEach(() => {
    monitor = new GitHubMonitor();
  });

  it("tracks and retrieves PRs per conversation", () => {
    const pr1 = monitor.trackPR("conv-1", "foo", "bar", 1);
    const pr2 = monitor.trackPR("conv-1", "foo", "bar", 2);
    const pr3 = monitor.trackPR("conv-2", "baz", "qux", 3);

    expect(pr1.id).toBe("foo/bar#1");
    expect(monitor.getTrackedPRs("conv-1")).toHaveLength(2);
    expect(monitor.getTrackedPRs("conv-2")).toHaveLength(1);
    expect(monitor.getTrackedPRs()).toHaveLength(3);
  });

  it("untracks PRs correctly", () => {
    monitor.trackPR("conv-1", "foo", "bar", 1);
    expect(monitor.getTrackedPRs("conv-1")).toHaveLength(1);

    const deleted = monitor.untrackPR("conv-1", "foo", "bar", 1);
    expect(deleted).toBe(true);
    expect(monitor.getTrackedPRs("conv-1")).toHaveLength(0);
  });

  it("processes webhooks and notifies event listeners", async () => {
    monitor.trackPR("conv-1", "L1M80", "porta", 100);

    const listener = vi.fn();
    monitor.onEvent(listener);

    const webhookPayload = {
      repository: { owner: { login: "L1M80" }, name: "porta" },
      pull_request: { number: 100 },
    };

    // Mock fetch for checkPRStatus
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/pulls/100/reviews")) {
        return new Response(JSON.stringify([{ state: "APPROVED" }]));
      }
      if (urlStr.includes("/commits/")) {
        return new Response(
          JSON.stringify({ check_runs: [{ name: "CI", status: "completed", conclusion: "success" }] }),
        );
      }
      if (urlStr.includes("/pulls/100")) {
        return new Response(JSON.stringify({ title: "Test PR", head: { sha: "abc1234" } }));
      }
      return new Response(JSON.stringify({}));
    });

    await monitor.processWebhook(webhookPayload, "pull_request_review");

    expect(listener).toHaveBeenCalled();
    const pr = monitor.getTrackedPRs("conv-1")[0];
    expect(pr.lastCiStatus).toBe("success");
    expect(pr.lastReviewState).toBe("APPROVED");

    fetchSpy.mockRestore();
  });
});

describe("GitHub Routes", () => {
  it("exposes track, list, untrack and webhook endpoints", async () => {
    const app = new Hono();
    registerGithubRoutes(app);

    // Track
    const resTrack = await app.request("/api/conversations/conv-test/github/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/testowner/testrepo/pull/777" }),
    });
    expect(resTrack.status).toBe(201);
    const jsonTrack = (await resTrack.json()) as any;
    expect(jsonTrack.ok).toBe(true);
    expect(jsonTrack.tracked[0].pullNumber).toBe(777);

    // List
    const resList = await app.request("/api/conversations/conv-test/github/prs");
    expect(resList.status).toBe(200);
    const jsonList = (await resList.json()) as any;
    expect(jsonList.prs).toHaveLength(1);
    expect(jsonList.prs[0].id).toBe("testowner/testrepo#777");

    // Untrack
    const resUntrack = await app.request(
      "/api/conversations/conv-test/github/prs/testowner/testrepo/777",
      { method: "DELETE" },
    );
    expect(resUntrack.status).toBe(200);

    const resList2 = await app.request("/api/conversations/conv-test/github/prs");
    expect(((await resList2.json()) as any).prs).toHaveLength(0);
  });
});
