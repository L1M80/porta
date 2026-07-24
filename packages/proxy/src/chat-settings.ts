/**
 * Per-chat settings storage & command auto-approval logic.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export interface ChatSettings {
  /** Executables that are auto-approved for this conversation (e.g. ["git", "node", "pnpm"]) */
  autoApprovedExecutables: string[];
  /** Whether to auto-approve ALL commands for this conversation */
  autoApproveAllCommands: boolean;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  autoApprovedExecutables: [],
  autoApproveAllCommands: false,
};

const SETTINGS_DIR = join(homedir(), ".anticrow");
const SETTINGS_FILE = join(SETTINGS_DIR, "chat_settings.json");

/** In-memory store: conversationId -> ChatSettings */
const settingsStore = new Map<string, ChatSettings>();
let isLoaded = false;

/**
 * Extract executable name from a raw command line string.
 * Examples:
 *   "git status" -> "git"
 *   "pnpm install" -> "pnpm"
 *   "node scripts/dev.js" -> "node"
 *   "FOO=bar python test.py" -> "python"
 *   "C:\\Program Files\\Git\\cmd\\git.exe log" -> "git"
 *   "cmd /c npx pnpm test" -> "pnpm"
 */
export function extractExecutable(commandLine: string): string {
  if (!commandLine) return "";
  let trimmed = commandLine.trim();

  // Strip environment variable definitions (e.g., "FOO=bar BAR=baz command")
  while (trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+/)) {
    trimmed = trimmed.replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+/, "");
  }

  // Split into tokens
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) return "";

  let rawExe = tokens[0];

  // If token is a wrapper like "cmd", "cmd.exe", "powershell", "powershell.exe", "npx", check next token
  const lowerRaw = rawExe.toLowerCase().replace(/\\/g, "/");
  const baseRaw = basename(lowerRaw).replace(/\.(exe|cmd|bat|ps1|sh)$/i, "");

  if (["cmd", "powershell", "pwsh", "npx", "exec", "sudo", "env"].includes(baseRaw) && tokens.length > 1) {
    // Look for the next non-flag token
    let idx = 1;
    while (idx < tokens.length && (tokens[idx].startsWith("-") || tokens[idx].startsWith("/"))) {
      idx++;
    }
    if (idx < tokens.length && tokens[idx]) {
      rawExe = tokens[idx];
    }
  }

  // Remove leading/trailing quotes
  rawExe = rawExe.replace(/^["']|["']$/g, "");

  // Take basename (handles Unix / Windows paths)
  let name = basename(rawExe.replace(/\\/g, "/"));

  // Strip extensions (.exe, .cmd, .bat, .ps1, .sh)
  name = name.replace(/\.(exe|cmd|bat|ps1|sh)$/i, "");

  return name.toLowerCase();
}

/** Load settings from disk */
export async function loadSettingsFromDisk(): Promise<void> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, ChatSettings>;
    settingsStore.clear();
    for (const [id, s] of Object.entries(data)) {
      settingsStore.set(id, {
        autoApprovedExecutables: Array.isArray(s.autoApprovedExecutables)
          ? s.autoApprovedExecutables.map((e) => e.toLowerCase())
          : [],
        autoApproveAllCommands: !!s.autoApproveAllCommands,
      });
    }
  } catch {
    // Disk file missing or unreadable — start fresh
  } finally {
    isLoaded = true;
  }
}

/** Save settings to disk */
export async function saveSettingsToDisk(): Promise<void> {
  try {
    await mkdir(SETTINGS_DIR, { recursive: true });
    const obj: Record<string, ChatSettings> = {};
    for (const [id, s] of settingsStore.entries()) {
      obj[id] = s;
    }
    await writeFile(SETTINGS_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch {
    // Ignore write errors (e.g. permission issues)
  }
}

/** Get settings for a conversation */
export function getChatSettings(conversationId: string): ChatSettings {
  const existing = settingsStore.get(conversationId);
  if (existing) {
    return {
      autoApprovedExecutables: [...existing.autoApprovedExecutables],
      autoApproveAllCommands: existing.autoApproveAllCommands,
    };
  }
  return { ...DEFAULT_CHAT_SETTINGS };
}

/** Update settings for a conversation */
export async function updateChatSettings(
  conversationId: string,
  patch: Partial<ChatSettings>,
): Promise<ChatSettings> {
  const current = getChatSettings(conversationId);

  let newExecutables = current.autoApprovedExecutables;
  if (Array.isArray(patch.autoApprovedExecutables)) {
    // Normalize to unique lower-cased strings
    const set = new Set(patch.autoApprovedExecutables.map((e) => e.trim().toLowerCase()).filter(Boolean));
    newExecutables = [...set];
  }

  const updated: ChatSettings = {
    autoApprovedExecutables: newExecutables,
    autoApproveAllCommands:
      typeof patch.autoApproveAllCommands === "boolean"
        ? patch.autoApproveAllCommands
        : current.autoApproveAllCommands,
  };

  settingsStore.set(conversationId, updated);
  await saveSettingsToDisk();
  return updated;
}

/** Check whether a command should be auto-approved for a conversation */
export function shouldAutoApproveCommand(
  conversationId: string,
  commandLine: string,
): { autoApprove: boolean; executable: string } {
  const exe = extractExecutable(commandLine);
  const settings = getChatSettings(conversationId);

  if (settings.autoApproveAllCommands) {
    return { autoApprove: true, executable: exe };
  }

  if (exe && settings.autoApprovedExecutables.includes(exe)) {
    return { autoApprove: true, executable: exe };
  }

  return { autoApprove: false, executable: exe };
}
