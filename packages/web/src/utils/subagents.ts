import type {
  SubagentDisplayData,
  SubagentDisplayDetail,
  SubagentDisplayItem,
  SubagentToolKind,
  ToolCallData,
  TrajectoryStep,
} from "../types";

const SUBAGENT_TOOL_KINDS: Record<string, SubagentToolKind> = {
  invoke_subagent: "invoke",
  define_subagent: "define",
  manage_subagents: "manage",
  send_message: "message",
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(argumentsJson?: string): JsonRecord | undefined {
  if (!argumentsJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringField(
  value: JsonRecord | undefined,
  ...names: string[]
): string | undefined {
  if (!value) return undefined;
  for (const name of names) {
    const field = value[name];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return undefined;
}

function stringArrayField(
  value: JsonRecord | undefined,
  ...names: string[]
): string[] {
  if (!value) return [];
  for (const name of names) {
    const field = value[name];
    if (!Array.isArray(field)) continue;
    return field.filter(
      (entry): entry is string => typeof entry === "string" && !!entry.trim(),
    );
  }
  return [];
}

function detail(label: string, text?: string): SubagentDisplayDetail[] {
  return text ? [{ label, text }] : [];
}

function parsedSubagents(args?: JsonRecord): JsonRecord[] {
  const value = args?.Subagents ?? args?.subagents;
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function invokeItems(
  step: TrajectoryStep,
  args?: JsonRecord,
): SubagentDisplayItem[] {
  const nativeItems = step.invokeSubagent?.subagents ?? [];
  if (nativeItems.length > 0) {
    return nativeItems.map((subagent) => ({
      role: subagent.role?.trim() || "Subagent",
      typeName: subagent.typeName?.trim() || "subagent",
      model: subagent.model?.trim() || subagent.modelTier?.trim() || undefined,
      details: detail("Instructions", subagent.initialPrompt?.trim()),
    }));
  }

  const items = parsedSubagents(args).map((subagent) => {
    const model = stringField(
      subagent,
      "Model",
      "model",
      "ModelTier",
      "modelTier",
    );
    return {
      role: stringField(subagent, "Role", "role") ?? "Subagent",
      typeName:
        stringField(subagent, "TypeName", "typeName", "Name", "name") ??
        "subagent",
      model,
      details: detail(
        "Instructions",
        stringField(
          subagent,
          "Prompt",
          "prompt",
          "InitialPrompt",
          "initialPrompt",
        ),
      ),
    };
  });
  if (items.length > 0) return items;

  const role =
    step.invokeSubagent?.subagentName?.trim() ||
    stringField(args, "SubagentName", "subagentName", "Role", "role");
  const prompt =
    step.invokeSubagent?.prompt?.trim() ||
    stringField(args, "Prompt", "prompt");

  return [
    {
      role: role || "Subagent",
      typeName: "subagent",
      details: detail("Instructions", prompt),
    },
  ];
}

function defineItems(args?: JsonRecord): SubagentDisplayItem[] {
  const name = stringField(args, "name", "Name") ?? "Subagent definition";
  const description = stringField(args, "description", "Description");
  const systemPrompt = stringField(args, "system_prompt", "systemPrompt");
  const details: SubagentDisplayDetail[] = [];
  if (description) details.push({ label: "Description", text: description });
  if (systemPrompt) details.push({ label: "System prompt", text: systemPrompt });
  return [{ role: name, typeName: "definition", details }];
}

function messageItems(args?: JsonRecord): SubagentDisplayItem[] {
  const recipient =
    stringField(args, "Recipient", "recipient") ?? "Subagent";
  const message = stringField(args, "Message", "message");
  return [
    {
      role: recipient,
      typeName: "message",
      details: detail("Message", message),
    },
  ];
}

function manageItems(args?: JsonRecord): SubagentDisplayItem[] {
  const action = stringField(args, "Action", "action") ?? "Manage";
  const ids = stringArrayField(
    args,
    "ConversationIds",
    "conversationIds",
    "conversation_ids",
  );
  return [
    {
      role: action.replaceAll("_", " "),
      typeName: "manage",
      details: detail("Conversation IDs", ids.join("\n")),
    },
  ];
}

function defaultTitle(
  kind: SubagentToolKind,
  items: SubagentDisplayItem[],
  args?: JsonRecord,
): string {
  switch (kind) {
    case "invoke":
      return items.length === 1
        ? "Subagent Invoked"
        : `${items.length} Subagents Invoked`;
    case "define":
      return `Define ${items[0]?.role ?? "Subagent"}`;
    case "message":
      return `Message to ${items[0]?.role ?? "Subagent"}`;
    case "manage": {
      const action = stringField(args, "Action", "action")?.toLowerCase();
      if (action === "list") return "List Subagents";
      if (action === "kill_all") return "Stop All Subagents";
      if (action === "kill") return "Stop Subagents";
      return "Manage Subagents";
    }
  }
}

export function isSubagentToolName(name?: string): name is string {
  return (
    !!name && Object.prototype.hasOwnProperty.call(SUBAGENT_TOOL_KINDS, name)
  );
}

/**
 * Converts both current native AG subagent steps and older tool-call-shaped
 * steps into a small display model. The fallback call covers older captures
 * where the native marker has no payload and arguments only exist on the
 * preceding planner response.
 */
export function subagentDataFromStep(
  step: TrajectoryStep,
  fallbackToolCall?: ToolCallData,
): SubagentDisplayData | undefined {
  const nativeInvoke =
    step.type === "CORTEX_STEP_TYPE_INVOKE_SUBAGENT" ||
    step.type === "CORTEX_STEP_TYPE_SUBAGENT";
  const toolCall = step.metadata?.toolCall ?? fallbackToolCall;
  const toolName = nativeInvoke
    ? toolCall?.name || "invoke_subagent"
    : toolCall?.name;
  if (!isSubagentToolName(toolName)) return undefined;

  const kind = SUBAGENT_TOOL_KINDS[toolName];
  const args = parseArguments(toolCall?.argumentsJson);
  const items =
    kind === "invoke"
      ? invokeItems(step, args)
      : kind === "define"
        ? defineItems(args)
        : kind === "message"
          ? messageItems(args)
          : manageItems(args);
  const legacySummary = stringField(args, "toolSummary", "tool_summary");
  const legacyAction = stringField(args, "toolAction", "tool_action");

  return {
    toolName,
    kind,
    title:
      step.metadata?.toolSummary ||
      legacySummary ||
      defaultTitle(kind, items, args),
    action: step.metadata?.toolAction || legacyAction,
    items,
  };
}
