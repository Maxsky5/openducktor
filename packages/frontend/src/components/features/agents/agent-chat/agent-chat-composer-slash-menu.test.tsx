import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { AgentChatComposerSlashMenu } from "./agent-chat-composer-slash-menu";

const COMMANDS = [
  {
    id: "one",
    trigger: "one",
    title: "one",
    description: "First command",
    hints: [],
  },
  {
    id: "two",
    trigger: "two",
    title: "two",
    description: "Second command",
    hints: [],
  },
];

const LISTBOX_ID = "slash-listbox";

describe("AgentChatComposerSlashMenu", () => {
  test("renders active command with selected-surface styling and pointer cursor", () => {
    render(
      <AgentChatComposerSlashMenu
        listboxId={LISTBOX_ID}
        commands={COMMANDS}
        activeIndex={0}
        slashCommandsError={null}
        isSlashCommandsLoading={false}
        onSelectCommand={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Slash commands" });
    const activeCommand = screen.getByRole("option", { name: /first command/i });

    expect(listbox.id).toBe(LISTBOX_ID);
    expect(activeCommand.className).toContain("cursor-pointer");
    expect(activeCommand.className).toContain("bg-selected-surface");
    expect(activeCommand.className).not.toContain("bg-primary/20");
    expect(activeCommand.id).toBe(`${LISTBOX_ID}-option-0`);
    expect(activeCommand.getAttribute("aria-selected")).toBe("true");
    expect(activeCommand.getAttribute("tabindex")).toBe("-1");
  });

  test("scrolls the active command into view when keyboard navigation changes selection", () => {
    const scrollIntoView = mock(() => {});
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const rendered = render(
        <AgentChatComposerSlashMenu
          listboxId={LISTBOX_ID}
          commands={COMMANDS}
          activeIndex={0}
          slashCommandsError={null}
          isSlashCommandsLoading={false}
          onSelectCommand={() => {}}
        />,
      );

      rendered.rerender(
        <AgentChatComposerSlashMenu
          listboxId={LISTBOX_ID}
          commands={COMMANDS}
          activeIndex={1}
          slashCommandsError={null}
          isSlashCommandsLoading={false}
          onSelectCommand={() => {}}
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("shows runtime errors without hiding reusable prompt commands", () => {
    const firstCommand = COMMANDS[0];
    if (!firstCommand) {
      throw new Error("Expected a slash command fixture.");
    }

    render(
      <AgentChatComposerSlashMenu
        listboxId={LISTBOX_ID}
        commands={[{ ...firstCommand, source: "custom" }]}
        activeIndex={0}
        slashCommandsError="Runtime commands failed"
        isSlashCommandsLoading={false}
        onSelectCommand={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Slash commands" });
    const errorFeedback = screen.getByText("Runtime commands failed");
    expect(listbox.contains(errorFeedback)).toBe(false);
    expect(screen.getByRole("option", { name: /first command/i })).toBeTruthy();
    expect(screen.getByText("custom")).toBeTruthy();
  });

  test("announces empty feedback outside the controlled listbox", () => {
    render(
      <AgentChatComposerSlashMenu
        listboxId={LISTBOX_ID}
        commands={[]}
        activeIndex={0}
        slashCommandsError={null}
        isSlashCommandsLoading={false}
        onSelectCommand={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Slash commands" });
    const emptyFeedback = screen.getByRole("status");

    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.children).toHaveLength(0);
    expect(listbox.contains(emptyFeedback)).toBe(false);
    expect(emptyFeedback.textContent).toBe("No slash commands found.");
  });
});
