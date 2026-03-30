import { afterEach, describe, expect, mock, test } from "bun:test";
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

afterEach(() => {
  mock.restore();
});

describe("AgentChatComposerSlashMenu", () => {
  test("renders command rows with pointer cursor affordance", () => {
    render(
      <AgentChatComposerSlashMenu
        commands={COMMANDS}
        activeIndex={0}
        slashCommandsError={null}
        isSlashCommandsLoading={false}
        onSelectCommand={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /first command/i }).className).toContain(
      "cursor-pointer",
    );
  });

  test("scrolls the active command into view when keyboard navigation changes selection", () => {
    const scrollIntoView = mock(() => {});
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const rendered = render(
        <AgentChatComposerSlashMenu
          commands={COMMANDS}
          activeIndex={0}
          slashCommandsError={null}
          isSlashCommandsLoading={false}
          onSelectCommand={() => {}}
        />,
      );

      rendered.rerender(
        <AgentChatComposerSlashMenu
          commands={COMMANDS}
          activeIndex={1}
          slashCommandsError={null}
          isSlashCommandsLoading={false}
          onSelectCommand={() => {}}
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
