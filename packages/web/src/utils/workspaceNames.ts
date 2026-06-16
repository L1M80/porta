import type { Workspace } from "../types";

const ANTIGRAVITY_PLAYGROUND_NAME = "Antigravity Playground";

interface WorkspaceNameOptions {
  collapseAntigravityPlayground?: boolean;
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function lastPathSegment(uri: string): string {
  const path = uri.replace(/^file:\/\//, "").replace(/\\/g, "/");
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? uri;
}

export function workspaceNameFromUri(uri: string): string {
  return safeDecodeUriComponent(lastPathSegment(uri));
}

export function isAntigravityPlaygroundUri(uri: string): boolean {
  const normalized = safeDecodeUriComponent(uri)
    .replace(/\\/g, "/")
    .toLowerCase();
  return normalized.includes("/.gemini/antigravity/playground/");
}

export function workspaceNameFromMetadata(
  workspace?: Workspace,
  options: WorkspaceNameOptions = {},
): string {
  if (!workspace) return "Others";

  const uri = workspace.workspaceFolderAbsoluteUri;
  if (
    options.collapseAntigravityPlayground &&
    uri &&
    isAntigravityPlaygroundUri(uri)
  ) {
    return ANTIGRAVITY_PLAYGROUND_NAME;
  }

  const repoName = workspace.repository?.computedName?.split("/").pop();
  if (repoName) return safeDecodeUriComponent(repoName);

  return uri ? workspaceNameFromUri(uri) : "Others";
}
