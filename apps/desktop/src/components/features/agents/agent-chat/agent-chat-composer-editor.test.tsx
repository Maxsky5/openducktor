import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useRef, useState } from "react";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";
import { createComposerDraft } from "./agent-chat-test-fixtures";

let AgentChatComposerEditor: typeof import("./agent-chat-composer-editor").AgentChatComposerEditor;

beforeAll(async () => {
  mock.module("./agent-chat-composer-selection", () => ({
    EMPTY_TEXT_SEGMENT_SENTINEL: "\u200B",
    readEditableTextContent: (element: HTMLElement): string =>
      (element.textContent ?? "").replace(/\u200B/g, ""),
    getCaretOffsetWithinElement: (element: HTMLElement): number =>
      (element.textContent ?? "").replace(/\u200B/g, "").length,
    setCaretOffsetWithinElement: () => {},
  }));

  ({ AgentChatComposerEditor } = await import("./agent-chat-composer-editor"));
});

afterAll(() => {
  mock.restore();
});

const COMMANDS = [
  {
    id: "compact",
    trigger: "compact",
    title: "compact",
    description: "Compact the current session",
    hints: ["compact"],
  },
];

const EditorHarness = ({
  slashCommandsError,
  slashCommands,
}: {
  slashCommandsError: string | null;
  slashCommands: typeof COMMANDS;
}): ReactElement => {
  const [draft, setDraft] = useState<AgentChatComposerDraft>(createComposerDraft(""));
  const editorRef = useRef<HTMLDivElement>(null);

  return (
    <AgentChatComposerEditor
      draft={draft}
      onDraftChange={setDraft}
      placeholder="Type a message"
      disabled={false}
      editorRef={editorRef}
      onEditorInput={() => {}}
      onSend={() => {}}
      supportsSlashCommands={true}
      slashCommands={slashCommands}
      slashCommandsError={slashCommandsError}
      isSlashCommandsLoading={false}
    />
  );
};

const typeIntoEditor = (container: HTMLElement, value: string): HTMLDivElement => {
  const editable = container.querySelector('[contenteditable="true"]');
  if (!(editable instanceof HTMLDivElement)) {
    throw new Error("Expected editable composer segment");
  }
  editable.textContent = value;
  fireEvent.input(editable);
  return editable;
};

describe("AgentChatComposerEditor", () => {
  test("shows the slash-command error state after typing a slash trigger", async () => {
    const rendered = render(
      <EditorHarness slashCommands={COMMANDS} slashCommandsError="Slash commands unavailable." />,
    );

    typeIntoEditor(rendered.container, "/");

    await waitFor(() => {
      expect(screen.getByText("Slash commands unavailable.")).toBeDefined();
    });
  });

  test("shows an empty state when slash filtering has no matches", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    typeIntoEditor(rendered.container, "/missing");

    await waitFor(() => {
      expect(screen.getByText("No slash commands found.")).toBeDefined();
    });
  });
});
