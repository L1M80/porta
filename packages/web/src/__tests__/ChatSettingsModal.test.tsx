import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ChatSettingsModal } from "../components/ChatSettingsModal";
import type { ChatSettings } from "../types";

describe("ChatSettingsModal", () => {
  const defaultSettings: ChatSettings = {
    autoApprovedExecutables: ["git", "node"],
    autoApproveAllCommands: false,
  };

  it("does not render when isOpen is false", () => {
    render(
      <ChatSettingsModal
        isOpen={false}
        onClose={vi.fn()}
        cascadeId="conv-1"
        settings={defaultSettings}
        onUpdateSettings={vi.fn()}
      />,
    );
    expect(screen.queryByText("Chat Settings")).not.toBeInTheDocument();
  });

  it("renders configured executables and presets when isOpen is true", () => {
    render(
      <ChatSettingsModal
        isOpen={true}
        onClose={vi.fn()}
        cascadeId="conv-1"
        chatTitle="My Conversation"
        settings={defaultSettings}
        onUpdateSettings={vi.fn()}
      />,
    );

    expect(screen.getByText("Chat Settings")).toBeInTheDocument();
    expect(screen.getByText("My Conversation")).toBeInTheDocument();
    expect(screen.getByText("git")).toBeInTheDocument();
    expect(screen.getByText("node")).toBeInTheDocument();
  });

  it("adds preset executable when clicking preset chip", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatSettingsModal
        isOpen={true}
        onClose={vi.fn()}
        cascadeId="conv-1"
        settings={{ autoApprovedExecutables: ["git"], autoApproveAllCommands: false }}
        onUpdateSettings={onUpdate}
      />,
    );

    const pnpmChip = screen.getByRole("button", { name: /\+ pnpm/i });
    await userEvent.click(pnpmChip);

    expect(onUpdate).toHaveBeenCalledWith({
      autoApprovedExecutables: ["git", "pnpm"],
    });
  });

  it("removes executable when clicking remove button", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatSettingsModal
        isOpen={true}
        onClose={vi.fn()}
        cascadeId="conv-1"
        settings={defaultSettings}
        onUpdateSettings={onUpdate}
      />,
    );

    const removeGitBtn = screen.getByTitle("Remove git");
    await userEvent.click(removeGitBtn);

    expect(onUpdate).toHaveBeenCalledWith({
      autoApprovedExecutables: ["node"],
    });
  });

  it("adds custom executable when submitted", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatSettingsModal
        isOpen={true}
        onClose={vi.fn()}
        cascadeId="conv-1"
        settings={defaultSettings}
        onUpdateSettings={onUpdate}
      />,
    );

    const input = screen.getByPlaceholderText(/Executable name/i);
    await userEvent.type(input, "cargo");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onUpdate).toHaveBeenCalledWith({
      autoApprovedExecutables: ["git", "node", "cargo"],
    });
  });
});
