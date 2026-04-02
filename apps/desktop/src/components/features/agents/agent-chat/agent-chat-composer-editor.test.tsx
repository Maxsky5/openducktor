import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { AgentFileSearchResult } from "@openducktor/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactElement, useRef, useState } from "react";
import { type AgentChatComposerDraft, createComposerAttachment } from "./agent-chat-composer-draft";
import { buildFileSearchResult, createComposerDraft } from "./agent-chat-test-fixtures";

let AgentChatComposerEditor: typeof import("./agent-chat-composer-editor").AgentChatComposerEditor;
const renderMockEditableTextContent = (text: string): string => {
  if (text.length === 0) {
    return "\u200B";
  }

  return text.endsWith("\n") ? `${text}\u200B` : text;
};

const setCaretOffsetWithinElementMock = mock((element: HTMLElement, logicalOffset: number) => {
  const selection =
    element.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!selection) {
    return;
  }

  let textNode = element.firstChild;
  if (!(textNode instanceof Text)) {
    textNode = element.ownerDocument.createTextNode(
      renderMockEditableTextContent((element.textContent ?? "").replace(/\u200B/g, "")),
    );
    element.replaceChildren(textNode);
  }

  const textContent = textNode.textContent ?? "";
  const boundedOffset =
    textContent === "\u200B" ? 1 : Math.max(0, Math.min(logicalOffset, textContent.length));
  const range = element.ownerDocument.createRange();
  range.setStart(textNode, boundedOffset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
});
const getCaretOffsetWithinElementMock = mock(
  (element: HTMLElement): number | null =>
    (element.textContent ?? "").replace(/\u200B/g, "").length,
);

beforeAll(async () => {
  mock.module("./agent-chat-composer-selection", () => ({
    EMPTY_TEXT_SEGMENT_SENTINEL: "\u200B",
    readEditableTextContent: (element: HTMLElement): string =>
      (element.textContent ?? "").replace(/\u200B/g, ""),
    renderEditableTextContent: renderMockEditableTextContent,
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
    <>
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
      <output data-testid="draft-state">{JSON.stringify(draft)}</output>
    </>
  );
};

const getEditorRoot = (container: HTMLElement): HTMLElement => {
  const editorRoot = container.querySelector('[contenteditable="true"]');
  if (!(editorRoot instanceof HTMLElement)) {
    throw new Error("Expected editable composer root");
  }

  return editorRoot;
};

const getTextSegments = (container: HTMLElement): HTMLElement[] => {
  return Array.from(container.querySelectorAll("[data-text-segment-id]")).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
};

const getLastTextSegment = (container: HTMLElement): HTMLElement => {
  const textSegments = getTextSegments(container);
  const editable = textSegments.at(-1);
  if (!(editable instanceof HTMLElement)) {
    throw new Error("Expected editable composer text segment");
  }

  return editable;
};

const collapseSelectionOnEditorRoot = (container: HTMLElement): HTMLElement => {
  const editorRoot = getEditorRoot(container);
  const collapsedRange = document.createRange();
  collapsedRange.setStart(editorRoot, 0);
  collapsedRange.collapse(true);
  const selection = globalThis.getSelection?.();
  selection?.removeAllRanges();
  selection?.addRange(collapsedRange);
  return editorRoot;
};

const expectComposerText = async (container: HTMLElement, text: string): Promise<void> => {
  await waitFor(() => {
    const contentRoot = container.querySelector("[data-composer-content-root]");
    expect((contentRoot?.textContent ?? "").replace(/\u200B/g, "")).toBe(text);
  });
};

const typeIntoEditor = (container: HTMLElement, value: string): HTMLElement => {
  const editable = getLastTextSegment(container);
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

  fireEvent.input(editable);
  return getLastTextSegment(container);
};

const selectAllComposerContents = (container: HTMLElement): HTMLElement => {
  const editorRoot = getEditorRoot(container);
  fireEvent.keyDown(editorRoot, {
    key: "a",
    metaKey: true,
  });
  return editorRoot;
};

const selectComposerContentRange = (container: HTMLElement): HTMLElement => {
  const editorRoot = getEditorRoot(container);
  const contentRoot = container.querySelector("[data-composer-content-root]");
  if (!(contentRoot instanceof HTMLElement)) {
    throw new Error("Expected composer content root");
  }

  const range = document.createRange();
  range.selectNodeContents(contentRoot);
  const selection = globalThis.getSelection?.();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return editorRoot;
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

  test("selects a slash command from pointer down without submitting the message", async () => {
    const onSend = mock(() => {});
    const rendered = render(
      <EditorHarness slashCommands={COMMANDS} slashCommandsError={null} onSend={onSend} />,
    );

    typeIntoEditor(rendered.container, "/");

    const commandButton = await screen.findByRole("button", {
      name: /compact the current session/i,
    });

    fireEvent.pointerDown(commandButton);

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")?.textContent).toContain(
        "/compact",
      );
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

  test("preserves plain text typing order across rerenders", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    typeIntoEditor(rendered.container, "a");
    typeIntoEditor(rendered.container, "ab");
    typeIntoEditor(rendered.container, "abc");

    await waitFor(() => {
      const editable = rendered.container.querySelector("[data-text-segment-id]");
      expect(editable?.textContent).toBe("abc");
    });
  });

  test("selects the full composer content with the select-all shortcut", () => {
    let activeRange: Range | null = null;
    const originalGetSelection = globalThis.getSelection;
    const selection = {
      removeAllRanges: () => {
        activeRange = null;
      },
      addRange: (range: Range) => {
        activeRange = range;
      },
      get rangeCount() {
        return activeRange ? 1 : 0;
      },
      getRangeAt: () => {
        if (!activeRange) {
          throw new Error("Expected active selection range");
        }
        return activeRange;
      },
    } as unknown as Selection;
    globalThis.getSelection = () => selection;

    try {
      const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);
      typeIntoEditor(rendered.container, "hello");
      fireEvent.keyDown(getEditorRoot(rendered.container), {
        key: "a",
        metaKey: true,
      });

      const selectedRange = activeRange as Range | null;
      expect(selectedRange).toBeTruthy();
      if (!selectedRange) {
        throw new Error("Expected active selection range");
      }
      expect(selectedRange.toString()).toContain("hello");
    } finally {
      globalThis.getSelection = originalGetSelection;
    }
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

  test("selects a file reference from pointer down without submitting the message", async () => {
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

    typeIntoEditor(rendered.container, "check @");

    const fileButton = await screen.findByRole("button", { name: /main.ts/i });
    fireEvent.pointerDown(fileButton);

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")?.textContent).toContain(
        "main.ts",
      );
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(searchFiles).toHaveBeenCalledWith("");
  });

  test("shows the full file path in a hover tooltip for composer file chips", async () => {
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={async () => [buildFileSearchResult()]}
      />,
    );

    const editable = typeIntoEditor(rendered.container, "check @");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /main.ts/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      const chip = rendered.container.querySelector("[data-chip-segment-id]");
      expect(chip?.textContent).toContain("main.ts");
      expect(chip?.getAttribute("data-file-reference-path")).toBe("src/main.ts");
    });

    const chip = rendered.container.querySelector("[data-chip-segment-id]");
    if (!(chip instanceof HTMLElement)) {
      throw new Error("Expected composer file chip");
    }

    fireEvent.mouseOver(chip);

    await waitFor(() => {
      expect(screen.getByText("src/main.ts")).toBeDefined();
    });

    fireEvent.mouseOut(chip, { relatedTarget: getEditorRoot(rendered.container) });

    await waitFor(() => {
      expect(screen.queryByText("src/main.ts")).toBeNull();
    });
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

  test("restores the placeholder after clearing a full composer selection with backspace", async () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    typeIntoEditor(rendered.container, "hello");
    expect(screen.queryByText("Type a message")).toBeNull();

    selectAllComposerContents(rendered.container);
    const editorRoot = selectComposerContentRange(rendered.container);
    fireEvent.keyDown(editorRoot, { key: "Backspace" });

    await waitFor(() => {
      expect(screen.getByText("Type a message")).toBeDefined();
      expect(rendered.container.querySelector("[data-composer-content-root]")?.textContent).toBe(
        "\u200B",
      );
    });
  });

  test("preserves staged attachments when clearing a full composer selection", async () => {
    resetSelectionMocks();
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        initialDraft={{
          segments: createComposerDraft("hello").segments,
          attachments: [
            createComposerAttachment(
              {
                name: "screenshot.png",
                kind: "image",
                mime: "image/png",
                path: "/tmp/screenshot.png",
              },
              "attachment-1",
            ),
          ],
        }}
      />,
    );

    selectAllComposerContents(rendered.container);
    const editorRoot = selectComposerContentRange(rendered.container);
    fireEvent.keyDown(editorRoot, { key: "Backspace" });

    await waitFor(() => {
      const draftState = screen.getByTestId("draft-state").textContent;
      if (!draftState) {
        throw new Error("Expected draft state output");
      }
      const parsed = JSON.parse(draftState) as AgentChatComposerDraft;
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments?.[0]?.name).toBe("screenshot.png");
      expect(parsed.segments).toHaveLength(1);
      expect(parsed.segments[0]).toMatchObject({ kind: "text", text: "" });
    });
  });

  test("stays operable after clearing a full selection and remounting another session", async () => {
    resetSelectionMocks();
    const rendered = render(
      <EditorHarness
        key="session-a"
        slashCommands={COMMANDS}
        slashCommandsError={null}
        initialDraft={createComposerDraft("hello")}
      />,
    );

    selectAllComposerContents(rendered.container);
    const editorRoot = selectComposerContentRange(rendered.container);
    fireEvent.keyDown(editorRoot, { key: "Backspace" });

    await waitFor(() => {
      expect(screen.getByText("Type a message")).toBeDefined();
    });

    expect(() => {
      rendered.rerender(
        <EditorHarness
          key="session-b"
          slashCommands={COMMANDS}
          slashCommandsError={null}
          initialDraft={createComposerDraft("next")}
        />,
      );
    }).not.toThrow();

    typeIntoEditor(rendered.container, "next session");

    await waitFor(() => {
      expect(screen.queryByText("Type a message")).toBeNull();
      expect(rendered.container.querySelector("[data-composer-content-root]")?.textContent).toBe(
        "next session",
      );
    });
  });

  test("inserts a newline on the first shift-enter", async () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello");
    fireEvent.keyDown(editable, { key: "Enter", shiftKey: true });

    await expectComposerText(rendered.container, "hello\n");
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

    await expectComposerText(rendered.container, "hello\n");
  });

  test("falls back to the last known caret offset when shift-enter keydown loses selection", async () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello");
    getCaretOffsetWithinElementMock
      .mockImplementationOnce(() => 5)
      .mockImplementationOnce(() => null);

    fireEvent.keyDown(editable, { key: "Enter", shiftKey: true });

    await expectComposerText(rendered.container, "hello\n");
  });

  test("repairs the first shift-enter when selection is collapsed on the editor root", async () => {
    resetSelectionMocks();
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        initialDraft={createComposerDraft("hello")}
      />,
    );

    const editorRoot = collapseSelectionOnEditorRoot(rendered.container);
    fireEvent.keyDown(editorRoot, { key: "Enter", shiftKey: true });

    await expectComposerText(rendered.container, "hello\n");
  });

  test("renders a trailing sentinel after the first shift-enter so the final blank line is visible", async () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "hello");
    fireEvent.keyDown(editable, { key: "Enter", shiftKey: true });

    await waitFor(() => {
      expect(getLastTextSegment(rendered.container).textContent).toBe("hello\n\u200B");
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

  test("does not replace the trailing text segment after typing after a slash chip", async () => {
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "/");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /compact the current session/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")?.textContent).toContain(
        "/compact",
      );
    });

    const originalTrailingEditable =
      rendered.container.querySelectorAll("[data-text-segment-id]")[0];
    if (!(originalTrailingEditable instanceof HTMLElement)) {
      throw new Error("Expected trailing editable text segment");
    }

    originalTrailingEditable.textContent = " after";
    const textNode = originalTrailingEditable.firstChild;
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, originalTrailingEditable.textContent.length);
      range.collapse(true);
      const selection = globalThis.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    fireEvent.input(originalTrailingEditable);

    await waitFor(() => {
      const updatedTrailingEditable =
        rendered.container.querySelectorAll("[data-text-segment-id]")[0];
      expect(updatedTrailingEditable).toBe(originalTrailingEditable);
      expect(updatedTrailingEditable?.textContent).toBe(" after");
    });
  });

  test("does not refocus the caret on printable keyup after a slash chip when selection is transiently on the root", async () => {
    resetSelectionMocks();
    const rendered = render(<EditorHarness slashCommands={COMMANDS} slashCommandsError={null} />);

    const editable = typeIntoEditor(rendered.container, "/");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /compact the current session/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")?.textContent).toContain(
        "/compact",
      );
    });

    const trailingEditable = rendered.container.querySelectorAll("[data-text-segment-id]")[0];
    if (!(trailingEditable instanceof HTMLElement)) {
      throw new Error("Expected trailing editable text segment");
    }

    trailingEditable.textContent = "a";
    const textNode = trailingEditable.firstChild;
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.collapse(true);
      const selection = globalThis.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    fireEvent.input(trailingEditable);

    setCaretOffsetWithinElementMock.mockClear();
    const editorRoot = getEditorRoot(rendered.container);
    const collapsedRange = document.createRange();
    collapsedRange.setStart(editorRoot, 0);
    collapsedRange.collapse(true);
    const collapsedSelection = globalThis.getSelection?.();
    collapsedSelection?.removeAllRanges();
    collapsedSelection?.addRange(collapsedRange);

    fireEvent.keyUp(editorRoot, { key: "a" });

    expect(setCaretOffsetWithinElementMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /compact the current session/i })).toBeNull();
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

  test("switches the trailing text segment back to inline after typing after a file chip", async () => {
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
      expect(editables[0]?.className).toContain("inline-block");
    });

    const trailingEditable = rendered.container.querySelectorAll("[data-text-segment-id]")[0];
    if (!(trailingEditable instanceof HTMLElement)) {
      throw new Error("Expected trailing editable text segment");
    }

    trailingEditable.textContent = " after";
    const textNode = trailingEditable.firstChild;
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, trailingEditable.textContent.length);
      range.collapse(true);
      const selection = globalThis.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    fireEvent.input(trailingEditable.closest('[contenteditable="true"]') as HTMLElement);

    await waitFor(() => {
      const updatedTrailingEditable =
        rendered.container.querySelectorAll("[data-text-segment-id]")[0];
      expect(updatedTrailingEditable).toBeInstanceOf(HTMLElement);
      expect((updatedTrailingEditable as HTMLElement).className).toContain("inline");
      expect((updatedTrailingEditable as HTMLElement).className).not.toContain("inline-block");
      expect((updatedTrailingEditable as HTMLElement).className).not.toContain("min-w-[1px]");
    });
  });

  test("keeps typing in the trailing text segment after inserting a file chip", async () => {
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={async () => [buildFileSearchResult()]}
      />,
    );

    const editable = typeIntoEditor(rendered.container, "check @");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /main.ts/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")?.textContent).toContain(
        "main.ts",
      );
    });

    const trailingEditable = rendered.container.querySelectorAll("[data-text-segment-id]")[1];
    if (!(trailingEditable instanceof HTMLElement)) {
      throw new Error("Expected trailing editable text segment");
    }

    fireEvent.focus(trailingEditable);
    trailingEditable.textContent = " after";
    const textNode = trailingEditable.firstChild;
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, trailingEditable.textContent.length);
      range.collapse(true);
      const selection = globalThis.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    fireEvent.input(trailingEditable.closest('[contenteditable="true"]') as HTMLElement);

    await waitFor(() => {
      const editorRoot = rendered.container.querySelector("[data-composer-content-root]");
      expect(editorRoot?.textContent).toContain("check ");
      expect(editorRoot?.textContent).toContain("main.ts");
      expect(editorRoot?.textContent).toContain(" after");
    });
  });

  test("preserves the trailing text segment id after typing after a file chip", async () => {
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={async () => [buildFileSearchResult()]}
      />,
    );

    const editable = typeIntoEditor(rendered.container, "check @");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /main.ts/i })).toBeDefined();
    });
    fireEvent.keyDown(editable, { key: "Enter" });

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")?.textContent).toContain(
        "main.ts",
      );
    });

    const originalTrailingEditable =
      rendered.container.querySelectorAll("[data-text-segment-id]")[1];
    if (!(originalTrailingEditable instanceof HTMLElement)) {
      throw new Error("Expected trailing editable text segment");
    }

    const trailingSegmentId = originalTrailingEditable.dataset.textSegmentId;
    originalTrailingEditable.textContent = " ";
    const textNode = originalTrailingEditable.firstChild;
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.collapse(true);
      const selection = globalThis.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    fireEvent.input(originalTrailingEditable.closest('[contenteditable="true"]') as HTMLElement);

    await waitFor(() => {
      const updatedTrailingEditable =
        rendered.container.querySelectorAll("[data-text-segment-id]")[1];
      expect(updatedTrailingEditable).toBeInstanceOf(HTMLElement);
      expect((updatedTrailingEditable as HTMLElement).dataset.textSegmentId).toBe(
        trailingSegmentId,
      );
      expect(updatedTrailingEditable?.textContent).toBe(" ");
    });
  });

  test("repairs root-collapsed selection after a file chip so continued typing stays trailing", async () => {
    resetSelectionMocks();
    const searchFiles = mock(async () => [buildFileSearchResult()]);
    const rendered = render(
      <EditorHarness
        slashCommands={COMMANDS}
        slashCommandsError={null}
        searchFiles={searchFiles}
      />,
    );

    typeIntoEditor(rendered.container, "check @");
    const fileButton = await screen.findByRole("button", { name: /main.ts/i });
    fireEvent.pointerDown(fileButton);

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-chip-segment-id]")?.textContent).toContain(
        "main.ts",
      );
    });

    const trailingEditable = rendered.container.querySelectorAll("[data-text-segment-id]")[1];
    if (!(trailingEditable instanceof HTMLElement)) {
      throw new Error("Expected trailing editable text segment");
    }

    trailingEditable.textContent = "x";
    const firstTextNode = trailingEditable.firstChild;
    if (firstTextNode) {
      const range = document.createRange();
      range.setStart(firstTextNode, 1);
      range.collapse(true);
      const selection = globalThis.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    fireEvent.input(trailingEditable.closest('[contenteditable="true"]') as HTMLElement);

    const editorRoot = rendered.container.querySelector('[contenteditable="true"]');
    if (!(editorRoot instanceof HTMLElement)) {
      throw new Error("Expected composer editor root");
    }

    const collapsedRange = document.createRange();
    collapsedRange.setStart(editorRoot, 0);
    collapsedRange.collapse(true);
    const collapsedSelection = globalThis.getSelection?.();
    collapsedSelection?.removeAllRanges();
    collapsedSelection?.addRange(collapsedRange);

    const repairedTrailingEditable =
      rendered.container.querySelectorAll("[data-text-segment-id]")[1];
    if (!(repairedTrailingEditable instanceof HTMLElement)) {
      throw new Error("Expected repaired trailing editable text segment");
    }

    fireEvent(
      editorRoot,
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: " then @AuthContext",
      }),
    );
    repairedTrailingEditable.textContent = "x then @AuthContext";
    const repairedTextNode = repairedTrailingEditable.firstChild;
    if (repairedTextNode) {
      const range = document.createRange();
      range.setStart(repairedTextNode, repairedTrailingEditable.textContent.length);
      range.collapse(true);
      const selection = globalThis.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    fireEvent.input(editorRoot);

    await waitFor(() => {
      const composerRoot = rendered.container.querySelector("[data-composer-content-root]");
      expect(composerRoot?.textContent).toContain("check ");
      expect(composerRoot?.textContent).toContain("main.ts");
      expect(composerRoot?.textContent).toContain("x then @AuthContext");
    });

    await waitFor(() => {
      expect(within(rendered.container).getByRole("button", { name: /main.ts/i })).toBeDefined();
    });
  });
});
