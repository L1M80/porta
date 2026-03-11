import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_MODEL } from "../../src/constants";

interface ConversationState {
  id: string;
  createdTime: string;
  lastModifiedTime: string;
  summary: string;
  workspaceUri: string;
  steps: unknown[];
}

function nowIso() {
  return new Date().toISOString();
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export class MockApiServer {
  private readonly server;
  private readonly host = "127.0.0.1";
  private readonly workspaceUri = "file:///tmp/porta";
  private readonly workspaceName = "porta";
  private readonly port: number;
  private conversations = new Map<string, ConversationState>();
  private nextConversationNumber = 1;

  constructor(port: number) {
    this.port = port;
    this.server = createServer(this.handleRequest);
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  reset() {
    this.conversations.clear();
    this.nextConversationNumber = 1;
  }

  private conversationSummary(conversation: ConversationState) {
    return {
      summary: conversation.summary,
      stepCount: conversation.steps.length,
      lastModifiedTime: conversation.lastModifiedTime,
      trajectoryId: conversation.id,
      status: "CASCADE_RUN_STATUS_IDLE",
      createdTime: conversation.createdTime,
      workspaces: [
        {
          workspaceFolderAbsoluteUri: conversation.workspaceUri,
          repository: {
            computedName: `local/${this.workspaceName}`,
          },
        },
      ],
    };
  }

  private handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
    const pathname = url.pathname;

    try {
      if (method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, {
          status: "ok",
          proxy: { port: this.port, uptime: 1 },
          languageServers: [
            {
              pid: 1,
              httpsPort: 1,
              workspaceId: "mock-workspace",
              source: "mock",
            },
          ],
        });
        return;
      }

      if (method === "GET" && pathname === "/api/workspaces") {
        sendJson(res, 200, {
          workspaceInfos: [
            {
              workspaceUri: this.workspaceUri,
              gitRootUri: this.workspaceUri,
            },
          ],
        });
        return;
      }

      if (method === "GET" && pathname === "/api/models") {
        sendJson(res, 200, {
          clientModelConfigs: [
            {
              label: "Mock Default",
              modelOrAlias: { model: DEFAULT_MODEL },
              supportsImages: true,
              isRecommended: true,
            },
          ],
          defaultOverrideModelConfig: {
            modelOrAlias: { model: DEFAULT_MODEL },
          },
        });
        return;
      }

      if (method === "GET" && pathname === "/api/conversations") {
        const trajectorySummaries = Object.fromEntries(
          Array.from(this.conversations.values()).map((conversation) => [
            conversation.id,
            this.conversationSummary(conversation),
          ]),
        );
        sendJson(res, 200, { trajectorySummaries });
        return;
      }

      if (method === "GET" && pathname === "/api/search") {
        sendJson(res, 200, {
          query: url.searchParams.get("q") ?? "",
          results: [],
          totalConversations: this.conversations.size,
          elapsedMs: 1,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/conversations") {
        const body = await readJson(req);
        const workspaceUri =
          typeof body.workspaceFolderAbsoluteUri === "string"
            ? body.workspaceFolderAbsoluteUri
            : this.workspaceUri;
        const createdTime = nowIso();
        const conversation: ConversationState = {
          id: `conv-${this.nextConversationNumber++}`,
          createdTime,
          lastModifiedTime: createdTime,
          summary: "New Chat",
          workspaceUri,
          steps: [],
        };
        this.conversations.set(conversation.id, conversation);
        sendJson(res, 200, { cascadeId: conversation.id });
        return;
      }

      const stepsMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/steps$/);
      if (method === "GET" && stepsMatch) {
        const conversation = this.conversations.get(stepsMatch[1]);
        if (!conversation) {
          sendJson(res, 404, { error: "Conversation not found" });
          return;
        }

        const allSteps = conversation.steps;
        const offsetParam = Number(url.searchParams.get("offset") ?? "0");
        const limitParam = url.searchParams.get("limit");
        const tailParam = url.searchParams.get("tail");

        let offset = Math.max(0, offsetParam);
        let steps = allSteps.slice(offset);

        if (tailParam) {
          const tail = Math.max(0, Number(tailParam));
          offset = Math.max(0, allSteps.length - tail);
          steps = allSteps.slice(offset);
        } else if (limitParam) {
          const limit = Math.max(0, Number(limitParam));
          steps = allSteps.slice(offset, offset + limit);
        }

        sendJson(res, 200, {
          steps,
          offset,
          stepCount: allSteps.length,
        });
        return;
      }

      const messagesMatch = pathname.match(
        /^\/api\/conversations\/([^/]+)\/messages$/,
      );
      if (method === "POST" && messagesMatch) {
        const conversation = this.conversations.get(messagesMatch[1]);
        if (!conversation) {
          sendJson(res, 404, { error: "Conversation not found" });
          return;
        }

        const body = await readJson(req);
        const items = Array.isArray(body.items) ? body.items : [];
        const firstItem = items[0] as { text?: unknown } | undefined;
        const text =
          typeof firstItem?.text === "string" ? firstItem.text.trim() : "";
        const clientMessageId =
          typeof body.clientMessageId === "string" ? body.clientMessageId : "";

        conversation.summary = text || "New Chat";
        conversation.lastModifiedTime = nowIso();
        conversation.steps = [
          {
            type: "CORTEX_STEP_TYPE_USER_INPUT",
            clientMessageId,
            userInput: {
              items: [{ text }],
            },
          },
          {
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            plannerResponse: {
              modifiedResponse: `Mock response for: ${text}`,
              thinking: "Inspecting mock conversation state.",
              thinkingDuration: "0.2s",
            },
          },
        ];

        await delay(50);
        sendJson(res, 200, {});
        return;
      }

      const mutationMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/(stop|revert|file-permission|command-action)$/);
      if (method === "POST" && mutationMatch) {
        sendJson(res, 200, {});
        return;
      }

      const deleteMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (method === "DELETE" && deleteMatch) {
        this.conversations.delete(deleteMatch[1]);
        sendJson(res, 200, {});
        return;
      }

      sendJson(res, 404, { error: `Unhandled route: ${method} ${pathname}` });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown mock error",
      });
    }
  };
}
