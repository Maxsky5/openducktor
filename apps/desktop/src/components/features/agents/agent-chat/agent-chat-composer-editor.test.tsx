import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { AgentFileSearchResult } from "@openducktor/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useRef, useState } from "react";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";
import {
  createFileReferenceSegment,
  createSlashCommandSegment,
  createTextSegment,
} from "./agent-chat-composer-draft";
import { buildFileSearchResult, createComposerDraft } from "./agent-chat-test-fixtures";

let AgentChatComposerEditor: typeof import("./agent-chat-composer-editor").AgentChatComposerEditor;
const setCaretOffsetWithinElementMock = mock(() => {});
const getCaretOffsetWithinElementMock = mock(
  (element: HTMLElement): number | null =>
    (element.textContent ?? "").replace(/\u200B/g, "").length,
);

beforeAll(async () => {
  mock.module("./agent-chat-composer-selection", () => ({
    EMPTY_TEXT_SEGMENT_SENTINEL: "\u200B",
    readEditableTextContent: (element: HTMLElement): string =>
      (element.textContent ?? "").replace(/\u200B/g, ""),
    getCaretOffsetWithinElement: getCaretOffsetWithinElementMock,
    insertTextAtCaretWithinElement: (
      element: HTMLElement,
      text: string,
      fallbackOffset: number,
    ) => {
      const currentText = (element.textContent ?? "").replace(/\u200B/g, "");
      const nextText = `${currentText.slice(0, fallbackOffset)}${text}${currentText.slice(fallbackOffset)}`;
      element.textContent = nextText;
      return fallbackOffset + text.length;
    },
    setCaretOffsetWithinElement: setCaretOffsetWithinElementMock,
  }));

  ({ AgentChatComposerEditor } = await import("./agent-chat-composer-editor"));
});

afterAll(() => {
  mock.restore();
});

const resetSelectionMocks = (): void => {
  setCaretOffsetWithinElementMock.mockClear();
  getCaretOffsetWithinElementMock.mockImplementation(
    (element: HTMLElement): number | null =>
      (element.textContent ?? "").replace(/\u200B/g, "").length,
  );
};

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
  supportsFileSearch = true,
  searchFiles = async () => [],
  onSend,
  initialDraft = createComposerDraft(""),
}: {
  slashCommandsError: string | null;
  slashCommands: typeof COMMANDS;
  supportsFileSearch?: boolean;
  searchFiles?: (query: string) => Promise<ReturnType<typeof buildFileSearchResult>[]>;
  onSend?: () => void;
  initialDraft?: AgentChatComposerDraft;
}): ReactElement => {
  const [draft, setDraft] = useState<AgentChatComposerDraft>(initialDraft);
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
      supportsFileSearch={supportsFileSearch}
      slashCommands={slashCommands}
      slashCommandsError={slashCommandsError}
      isSlashCommandsLoading={false}
      searchFiles={searchFiles}
    />
  );
};

const typeIntoEditor = (container: HTMLElement, value: string): HTMLElement => {
  const editable = container.querySelector("[data-text-segment-id]");
  if (!(editable instanceof HTMLElement)) {
    throw new Error("Expected editable composer text segment");
  }
  editable.textContent = value;
  const textNode = editable.firstChild;
  if (textNode) {
    const range = document.createRange();
    range.setStart(textNode, value.length);
    range.collapse(true);
    const selection = globalThis.getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  const editorRoot = editable.closest('[contenteditable="true"]');
  if (!(editorRoot instanceof HTMLElement)) {
    throw new Error("Expected editable composer root");
  }
  fireEvent.input(editorRoot);
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
      expect(screen.getByText("/compact")).toBeDefined();
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("keeps slash autocomplete open through the keyup after typing slash", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "/");
    fireEvent.keyUp(editable, { key: "/" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /compact the current session/i })).toBeDefined();
    });
  });

  test("does not open slash autocomplete when slash is typed after normal text", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello /");
    fireEvent.keyUp(editable, { key: "/" });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /compact the current session/i })).toBeNull();
    });
  });

  test("shows the file-search error state after typing an @ trigger", async () => {
    const searchFiles = mock(async () => {
      throw new Error("File search unavailable.");
    });
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={searchFiles}
      />,
    );

    typeIntoEditor(rendered.container, "@");

    await waitFor(() => {
      expect(screen.getByText("File search unavailable.")).toBeDefined();
    });
  });

  test("shows a file-search empty state when no matches are returned", async () => {
    const searchFiles = mock(async () => []);
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={searchFiles}
      />,
    );

    typeIntoEditor(rendered.container, "@missing");

    await waitFor(() => {
      expect(screen.getByText("No files found.")).toBeDefined();
    });
  });

  test("keeps previous file-search results visible while the next query loads", async () => {
    let resolveSecondSearch: ((results: AgentFileSearchResult[]) => void) | null = null;
    const searchFiles = mock((query: string) => {
      if (query === "a") {
        return Promise.resolve([buildFileSearchResult({ path: "src/alpha.ts", name: "alpha.ts" })]);
      }
      if (query === "ab") {
        return new Promise<AgentFileSearchResult[]>((resolve) => {
          resolveSecondSearch = resolve;
        });
      }
      return Promise.resolve([]);
    });
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={searchFiles}
      />,
    );

    typeIntoEditor(rendered.container, "@a");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /alpha.ts/i })).toBeDefined();
    });

    typeIntoEditor(rendered.container, "@ab");

    expect(screen.getByRole("button", { name: /alpha.ts/i })).toBeDefined();
    expect(screen.queryByText("Searching files...")).toBeNull();

    if (!resolveSecondSearch) {
      throw new Error("Expected second file search to be pending");
    }
    const finishSecondSearch = resolveSecondSearch as (results: AgentFileSearchResult[]) => void;
    finishSecondSearch([buildFileSearchResult({ path: "src/ab.ts", name: "ab.ts" })]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /ab.ts/i })).toBeDefined();
    });
  });

  test("selects a file reference without submitting the message", async () => {
    const onSend = mock(() => {});
    const searchFiles = mock(async () => [buildFileSearchResult()]);
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={searchFiles}
        onSend={onSend}
      />,
    );

    const editable = typeIntoEditor(rendered.container, "check @");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /main.ts/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("main.ts")).toBeDefined();
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(searchFiles).toHaveBeenCalledWith("");
  });

  test("does not open file autocomplete when the runtime does not support file search", async () => {
    const searchFiles = mock(async () => [buildFileSearchResult()]);
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        supportsFileSearch={false}
        searchFiles={searchFiles}
      />,
    );

    typeIntoEditor(rendered.container, "@");

    await waitFor(() => {
      expect(screen.queryByText("main.ts")).toBeNull();
    });
    expect(searchFiles).not.toHaveBeenCalled();
  });

  test("keeps focus when backspace is pressed on an empty composer", () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "");
    fireEvent.focus(editable);
    fireEvent.keyDown(editable, { key: "Backspace" });

    expect(setCaretOffsetWithinElementMock).toHaveBeenCalledWith(editable, 0);
  });

  test("inserts a newline on the first shift-enter", async () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello");
    fireEvent.keyDown(editable, { key: "Enter", shiftKey: true });
    editable.textContent = "hello\n";
    fireEvent.input(editable);

    await waitFor(() => {
      const updatedEditable = rendered.container.querySelector('[contenteditable="true"]');
      expect(updatedEditable?.textContent).toBe("hello\n");
    });
  });

  test("inserts a newline from beforeinput line-break events", async () => {
    resetSelectionMocks();
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
    editable.textContent = "hello\n";
    fireEvent.input(editable);

    await waitFor(() => {
      const updatedEditable = rendered.container.querySelector('[contenteditable="true"]');
      expect(updatedEditable?.textContent).toBe("hello\n");
    });
  });

  test("falls back to the last known caret offset when shift-enter keydown loses selection", async () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello");
    getCaretOffsetWithinElementMock
      .mockImplementationOnce(() => 5)
      .mockImplementationOnce(() => null);

    fireEvent.keyDown(editable, { key: "Enter", shiftKey: true });
    editable.textContent = "hello\n";
    fireEvent.input(editable);

    await waitFor(() => {
      const updatedEditable = rendered.container.querySelector('[contenteditable="true"]');
      expect(updatedEditable?.textContent).toBe("hello\n");
    });
  });

  test("renders empty trailing text segments as inline blocks for caret placement after slash chips", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "/");
    fireEvent.keyUp(editable, { key: "/" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /compact the current session/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")).toBeTruthy();
      const editables = Array.from(rendered.container.querySelectorAll("[data-text-segment-id]"));
      expect(editables).toHaveLength(1);
      const trailingEditable = editables[0];
      expect(trailingEditable?.className).toContain("inline-block");
      expect(trailingEditable?.className).toContain("min-w-[1px]");
    });
  });

  test("renders empty trailing text segments as inline blocks for caret placement after file chips", async () => {
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={async () => [buildFileSearchResult()]}
      />,
    );

    const editable = typeIntoEditor(rendered.container, "@");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /main.ts/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      const editables = Array.from(rendered.container.querySelectorAll("[data-text-segment-id]"));
      expect(editables).toHaveLength(1);
      const trailingEditable = editables[0];
      expect(trailingEditable?.className).toContain("inline-block");
      expect(trailingEditable?.className).toContain("min-w-[1px]");
    });
  });
});
