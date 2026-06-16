import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "../api/client";
import {
  workspaceNameFromMetadata,
  workspaceNameFromUri,
} from "../utils/workspaceNames";

/** Extract a short slug from a workspace URI: file:///home/user/work/porta → porta */
function slugFromUri(uri: string): string {
  return workspaceNameFromUri(uri);
}

/** Resolve a slug back to a full workspace URI using the workspace list. */
function uriFromSlug(
  slug: string,
  workspaces: { uri: string; name: string }[],
): string | undefined {
  return workspaces.find((w) => slugFromUri(w.uri) === slug)?.uri;
}

interface ConversationEntry {
  id: string;
  summary: {
    workspaces?: {
      workspaceFolderAbsoluteUri?: string;
      repository?: { computedName?: string };
    }[];
  };
}

interface UseWorkspacesResult {
  workspaces: { uri: string; name: string }[];
  currentWorkspaceUri: string | undefined;
}

/**
 * Merge workspace sources: LS API + conversation metadata.
 * Returns a stable list of known workspaces and the resolved URI for the current URL slug.
 */
export function useWorkspaces(
  conversations: ConversationEntry[],
  projectSlug: string | undefined,
): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<{ uri: string; name: string }[]>(
    [],
  );
  const wsInitialized = useRef(false);

  useEffect(() => {
    // Collect from conversations
    const fromConvs = new Map<string, string>();
    for (const conv of conversations) {
      const ws = conv.summary.workspaces?.[0];
      if (!ws?.workspaceFolderAbsoluteUri) continue;
      const uri = ws.workspaceFolderAbsoluteUri;
      const name = workspaceNameFromMetadata(ws);
      fromConvs.set(uri, name);
    }

    // Collect from LS API
    api
      .getWorkspaces()
      .then((data) => {
        const fromApi = (data.workspaceInfos ?? []).map((w) => ({
          uri: w.workspaceUri,
          name: workspaceNameFromUri(w.workspaceUri),
        }));
        const merged = new Map<string, string>();
        for (const w of fromApi) merged.set(w.uri, w.name);
        for (const [uri, name] of fromConvs) {
          if (!merged.has(uri)) merged.set(uri, name);
        }
        const list = Array.from(merged, ([uri, name]) => ({ uri, name }));
        setWorkspaces(list);
        wsInitialized.current = true;
      })
      .catch(() => {
        const list = Array.from(fromConvs, ([uri, name]) => ({ uri, name }));
        setWorkspaces(list);
        wsInitialized.current = true;
      });
  }, [conversations]);

  const currentWorkspaceUri = useMemo(
    () => (projectSlug ? uriFromSlug(projectSlug, workspaces) : undefined),
    [projectSlug, workspaces],
  );

  return { workspaces, currentWorkspaceUri };
}

export { slugFromUri, uriFromSlug };
