import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useRef, useState } from "react";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";
import { createComposerDraft } from "./agent-chat-test-fixtures";

let AgentChatComposerEditor: typeof import("./agent-chat-composer-editor").AgentChatComposerEditor;
const setCaretOffsetWithinElementMock = mock(() => {});

beforeAll(async () => {
  mock.module("./agent-chat-composer-selection", () => ({
    EMPTY_TEXT_SEGMENT_SENTINEL: "\u200B",
    readEditableTextContent: (element: HTMLElement): string =>
      (element.textContent ?? "").replace(/\u200B/g, ""),
    getCaretOffsetWithinElement: (element: HTMLElement): number =>
      (element.textContent ?? "").replace(/\u200B/g, "").length,
    setCaretOffsetWithinElement: setCaretOffsetWithinElementMock,
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
  onSend,
}: {
  slashCommandsError: string | null;
  slashCommands: typeof COMMANDS;
  onSend?: () => void;
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
      onSend={onSend ?? (() => {})}
      supportsSlashCommands={true}
      slashCommands={slashCommands}
      slashCommandsError={slashCommandsError}
      isSlashCommandsLoading={false}
    />
  );
};

const typeIntoEditor = (container: HTMLElement, value: string): HTMLElement => {
  const editable = container.querySelector('[contenteditable="true"]');
  if (!(editable instanceof HTMLElement)) {
    throw new Error("Expected editable composer segment");
  }
  editable.textContent = value;
  fireEvent.input(editable);
  return editable;
};

const getEditorShell = (container: HTMLElement): HTMLDivElement => {
  const editable = typeIntoEditor(container, "");
  const shell = editable.closest('[aria-disabled="false"]');
  if (!(shell instanceof HTMLDivElement)) {
    throw new Error("Expected composer editor shell");
  }
  return shell;
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

  test("keeps slash-menu keyboard selection from submitting the message", async () => {
    const onSend = mock(() => {});
    const rendered = render(
      <EditorHarness slashCommands={COMMANDS} slashCommandsError={null} onSend={onSend} />,
    );

    const editable = typeIntoEditor(rendered.container, "/");
    fireEvent.keyDown(editable, { key: "ArrowDown" });
    fireEvent.keyUp(editable, { key: "ArrowDown" });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /slash command \/compact/i })).toBeDefined();
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("redirects empty-shell clicks to the editable text segment", () => {
    setCaretOffsetWithinElementMock.mockClear();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const shell = getEditorShell(rendered.container);
    fireEvent.mouseDown(shell);

    expect(setCaretOffsetWithinElementMock).toHaveBeenCalled();
  });

  test("preserves caret position after text input rerenders", () => {
    setCaretOffsetWithinElementMock.mockClear();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    typeIntoEditor(rendered.container, "hello");

    expect(setCaretOffsetWithinElementMock).toHaveBeenCalledWith(expect.any(HTMLElement), 5);
  });

  test("keeps slash autocomplete open through the keyup after typing slash", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "/");
    fireEvent.keyUp(editable, { key: "/" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /compact the current session/i })).toBeDefined();
    });
  });

  test("inserts a newline on the first shift-enter", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello");
    fireEvent.keyDown(editable, { key: "Enter", shiftKey: true });

    await waitFor(() => {
      const updatedEditable = rendered.container.querySelector('[contenteditable="true"]');
      expect(updatedEditable?.textContent).toBe("hello\n");
    });
  });

  test("inserts a newline from beforeinput line-break events", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello");
    fireEvent.keyDown(editable, { key: "Enter", shiftKey: true });
    fireEvent(
      editable,
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertLineBreak",
        data: null,
      }),
    );

    await waitFor(() => {
      const updatedEditable = rendered.container.querySelector('[contenteditable="true"]');
      expect(updatedEditable?.textContent).toBe("hello\n");
    });
  });
});
