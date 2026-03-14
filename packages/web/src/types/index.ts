export interface ConversationSummary {
  summary: string;
  stepCount: number;
  lastModifiedTime: string;
  trajectoryId: string;
  status: string;
  createdTime: string;
  workspaces: Workspace[];
  lastUserInputTime?: string;
  lastUserInputStepIndex?: number;
}

export interface MediaAttachment {
  mimeType: string;
  inlineData: string; // base64 encoded
}

export interface Workspace {
  workspaceFolderAbsoluteUri?: string;
  gitRootAbsoluteUri?: string;
  repository?: {
    computedName?: string;
    gitOriginUrl?: string;
  };
  branchName?: string;
}

export interface ConversationsResponse {
  trajectorySummaries: Record<string, ConversationSummary>;
}

export interface ConversationDetail {
  status?: string;
  numTotalSteps?: number;
}

export interface HealthResponse {
  status: string;
  proxy: { port: number; uptime: number };
  languageServers: {
    pid: number;
    httpsPort: number;
    workspaceId?: string;
    source: string;
  }[];
}

export type ConversationStatus =
  | "CASCADE_RUN_STATUS_IDLE"
  | "CASCADE_RUN_STATUS_RUNNING"
  | "CASCADE_RUN_STATUS_ERROR";

// ── File Permission ──

export interface FilePermissionRequest {
  absolutePathUri: string;
  blockReason?: string;
  isDirectory?: boolean;
}

// ── Trajectory Steps ──

export interface StepsResponse {
  steps: TrajectoryStep[];
}

/** Paginated steps response from GET /steps (includes offset + total) */
export interface StepsPageResponse {
  steps: TrajectoryStep[];
  offset: number;
  stepCount?: number;
}

export interface TrajectoryStep {
  type: string;
  clientMessageId?: string;
  status?: string;
  metadata?: StepMetadata;
  userInput?: { items: StepItem[]; media?: unknown[] };
  plannerResponse?: PlannerResponseData;
  runCommand?: RunCommandData;
  codeAction?: CodeActionData;
  commandStatus?: CommandStatusData;
  sendCommandInput?: SendCommandInputData;
  grepSearch?: GrepSearchData;
  viewFile?: ViewFileData;
  viewFileOutline?: ViewFileOutlineData;
  viewCodeItem?: ViewCodeItemData;
  listDirectory?: ListDirectoryData;
  find?: FindData;
  /** File permission request can appear on any tool step */
  filePermissionRequest?: FilePermissionRequest;
}

export interface PlannerResponseData {
  items?: StepItem[];
  modifiedResponse?: string;
  thinking?: string;
  thinkingDuration?: string;
}

export interface StepMetadata {
  createdAt?: string;
  completedAt?: string;
  source?: string;
  toolCall?: {
    id?: string;
    name?: string;
    argumentsJson?: string;
  };
  sourceTrajectoryStepInfo?: {
    trajectoryId?: string;
    stepIndex?: number;
  };
}

export interface RunCommandData {
  command?: string;
  commandLine?: string;
  commandId?: string;
  proposedCommandLine?: string;
  cwd?: string;
  blocking?: boolean;
  exitCode?: number;
  output?: string;
  combinedOutput?: {
    full?: string;
  };
}

export interface CommandStatusData {
  commandId?: string;
  status?: string;
  combined?: string;
}

export interface SendCommandInputData {
  terminate?: boolean;
}

export interface GrepSearchData {
  query?: string;
  results?: unknown[];
  searchPathUri?: string;
  filePermissionRequest?: FilePermissionRequest;
}

export interface ViewFileData {
  absolutePathUri?: string;
  startLine?: number;
  endLine?: number;
  filePermissionRequest?: FilePermissionRequest;
}

export interface ViewFileOutlineData {
  absolutePathUri?: string;
  filePermissionRequest?: FilePermissionRequest;
}

export interface ViewCodeItemData {
  absoluteUri?: string;
  nodePaths?: string[];
  filePermissionRequest?: FilePermissionRequest;
}

export interface ListDirectoryData {
  directoryPathUri?: string;
  results?: unknown[];
  filePermissionRequest?: FilePermissionRequest;
}

export interface FindData {
  pattern?: string;
  results?: unknown[];
}

export interface CodeActionData {
  description?: string;
  markdownLanguage?: string;
  actionSpec?: {
    createFile?: { path?: { absoluteUri?: string } };
  };
  actionResult?: {
    edit?: {
      absoluteUri?: string;
      createFile?: boolean;
      diff?: {
        unifiedDiff?: {
          lines?: DiffLine[];
        };
      };
    };
  };
  replacementInfos?: unknown[];
  filePermissionRequest?: FilePermissionRequest;
}

export interface DiffLine {
  text?: string;
  type:
    | "UNIFIED_DIFF_LINE_TYPE_UNCHANGED"
    | "UNIFIED_DIFF_LINE_TYPE_INSERT"
    | "UNIFIED_DIFF_LINE_TYPE_DELETE"
    | "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER";
}

export interface StepItem {
  text?: string;
}

/** Normalized message for display */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  stepIndex: number;
  type: string;
  /** Original step data for rich rendering */
  step?: TrajectoryStep;
  /** Media attachments (images/video) */
  media?: unknown[];
  /** Extended thinking / chain-of-thought content */
  thinking?: string;
  /** Duration string e.g. "4.739s" */
  thinkingDuration?: string;
  /** Icon key for system messages */
  icon?: string;
  /** Stable client-side identity for optimistic messages */
  optimisticId?: string;
  /** Local-only optimistic lifecycle state */
  optimisticState?: "unconfirmed" | "failed";
}

// ── Client Settings ──

export interface ClientSettings {
  /** Model ID used when the user hasn't explicitly picked one per-message. */
  defaultModel: string | null;
  /** Planner type used when the user hasn't explicitly picked one per-message. */
  defaultPlannerType: "conversational" | "planning";
}
