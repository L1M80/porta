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
  projectName?: string;
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
    appDataDir?: string;
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
  action?: string;
  /** Response field expected by HandleCascadeUserInteraction. */
  responseKind?: "filePermission" | "permission";
}

// ── Ask Question ──

export interface AskQuestionOption {
  id?: string;
  text?: string;
}

export interface AskQuestionEntry {
  question?: string;
  options?: AskQuestionOption[];
  isMultiSelect?: boolean;
  selectedOptionIds?: string[];
  writeInResponse?: string;
  skipped?: boolean;
}

export interface AskQuestionRequest {
  questions?: AskQuestionEntry[];
}

export interface AskQuestionInteraction {
  responses?: AskQuestionEntry[];
  cancelled?: boolean;
}

export interface RequestedInteractionData {
  askQuestion?: AskQuestionRequest;
  permission?: {
    resource?: {
      action?: string;
      target?: string;
    };
  };
}

export interface CompletedInteractionData {
  request?: RequestedInteractionData;
  response?: {
    askQuestion?: AskQuestionInteraction;
  };
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
  invokeSubagent?: InvokeSubagentData;
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
  askQuestion?: AskQuestionRequest;
  requestedInteraction?: RequestedInteractionData;
  completedInteractions?: CompletedInteractionData[];
  /** File permission request can appear on any tool step */
  filePermissionRequest?: FilePermissionRequest;
}

export interface PlannerResponseData {
  items?: StepItem[];
  modifiedResponse?: string;
  thinking?: string;
  thinkingDuration?: string;
  toolCalls?: ToolCallData[];
}

export interface ToolCallData {
  id?: string;
  name?: string;
  argumentsJson?: string;
}

export interface StepMetadata {
  createdAt?: string;
  completedAt?: string;
  source?: string;
  executionId?: string;
  toolCall?: ToolCallData;
  toolSummary?: string;
  toolAction?: string;
  sourceTrajectoryStepInfo?: {
    trajectoryId?: string;
    stepIndex?: number;
  };
}

export interface NativeSubagentSpec {
  typeName?: string;
  role?: string;
  initialPrompt?: string;
  model?: string;
  modelTier?: string;
}

export interface SubagentResult {
  conversationId?: string;
  logAbsoluteUri?: string;
  workspaceUris?: string[];
}

/** Native payload of CORTEX_STEP_TYPE_INVOKE_SUBAGENT. */
export interface InvokeSubagentData {
  subagents?: NativeSubagentSpec[];
  taskMode?: boolean;
  results?: SubagentResult[];
  /** Legacy single-subagent fields retained by the AG protocol. */
  subagentName?: string;
  prompt?: string;
  conversationId?: string;
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

export type SubagentToolKind = "invoke" | "define" | "manage" | "message";

export interface SubagentDisplayDetail {
  label: string;
  text: string;
}

export interface SubagentDisplayItem {
  role: string;
  typeName: string;
  model?: string;
  details: SubagentDisplayDetail[];
}

/** Sanitized, tool-independent data consumed by SubagentCard. */
export interface SubagentDisplayData {
  toolName: string;
  kind: SubagentToolKind;
  title: string;
  action?: string;
  items: SubagentDisplayItem[];
}

/** Normalized message for display */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  stepIndex: number;
  type: string;
  /** Original step data for rich rendering */
  step?: TrajectoryStep;
  /** Normalized subagent data for rich rendering */
  subagent?: SubagentDisplayData;
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

export type TargetApp = "all" | "antigravity" | "antigravity-ide";

// ── Client Settings ──

export interface ClientSettings {
  /** Model ID used when the user hasn't explicitly picked one per-message. */
  defaultModel: string | null;
  /** Planner type used when the user hasn't explicitly picked one per-message. */
  defaultPlannerType: "conversational" | "planning";
  /** Enables browser notifications for run completion and approval requests. */
  browserNotificationsEnabled: boolean;
  /** Target application engine filter (antigravity vs antigravity-ide vs all). */
  targetApp: TargetApp;
}
