import { describe, it, expect, beforeEach } from "vitest";
import {
  extractExecutable,
  getChatSettings,
  updateChatSettings,
  shouldAutoApproveCommand,
  loadSettingsFromDisk,
} from "../chat-settings";

describe("chat-settings", () => {
  describe("extractExecutable", () => {
    it("extracts simple executables", () => {
      expect(extractExecutable("git status")).toBe("git");
      expect(extractExecutable("node scripts/dev.js")).toBe("node");
      expect(extractExecutable("pnpm install")).toBe("pnpm");
      expect(extractExecutable("npm test")).toBe("npm");
    });

    it("strips environment variables", () => {
      expect(extractExecutable("NODE_ENV=production node server.js")).toBe("node");
      expect(extractExecutable("FOO=1 BAR=2 git diff")).toBe("git");
    });

    it("handles paths and extensions", () => {
      expect(extractExecutable("C:\\Program Files\\Git\\cmd\\git.exe checkout main")).toBe("git");
      expect(extractExecutable("/usr/local/bin/pnpm run build")).toBe("pnpm");
      expect(extractExecutable("./scripts/dev.sh")).toBe("dev");
    });

    it("handles command wrappers like cmd / powershell / npx", () => {
      expect(extractExecutable("cmd /c pnpm build")).toBe("pnpm");
      expect(extractExecutable("powershell -Command git status")).toBe("git");
      expect(extractExecutable("npx vitest run")).toBe("vitest");
    });

    it("handles empty or whitespace strings", () => {
      expect(extractExecutable("")).toBe("");
      expect(extractExecutable("   ")).toBe("");
    });
  });

  describe("getChatSettings & updateChatSettings", () => {
    const convId = "test-conv-settings-1";

    it("returns default settings initially", () => {
      const s = getChatSettings(convId);
      expect(s.autoApprovedExecutables).toEqual([]);
      expect(s.autoApproveAllCommands).toBe(false);
    });

    it("updates autoApprovedExecutables", async () => {
      await updateChatSettings(convId, {
        autoApprovedExecutables: ["git", "node", "PNPM", "git"], // with duplicates & uppercase
      });

      const s = getChatSettings(convId);
      expect(s.autoApprovedExecutables).toEqual(["git", "node", "pnpm"]);
    });

    it("toggles autoApproveAllCommands", async () => {
      await updateChatSettings(convId, { autoApproveAllCommands: true });
      expect(getChatSettings(convId).autoApproveAllCommands).toBe(true);
    });

    it("correctly evaluates shouldAutoApproveCommand", async () => {
      const id = "test-conv-settings-2";

      // Initially false
      expect(shouldAutoApproveCommand(id, "git commit -m 'test'")).toEqual({
        autoApprove: false,
        executable: "git",
      });

      // Add git
      await updateChatSettings(id, { autoApprovedExecutables: ["git"] });

      expect(shouldAutoApproveCommand(id, "git commit -m 'test'")).toEqual({
        autoApprove: true,
        executable: "git",
      });

      expect(shouldAutoApproveCommand(id, "pnpm test")).toEqual({
        autoApprove: false,
        executable: "pnpm",
      });

      // Enable auto approve all
      await updateChatSettings(id, { autoApproveAllCommands: true });

      expect(shouldAutoApproveCommand(id, "pnpm test")).toEqual({
        autoApprove: true,
        executable: "pnpm",
      });
    });
  });
});
