import { describe, expect, mock, test } from "bun:test";
import type { AgentSlashCommand } from "@openducktor/core";
import {
  createFileReferenceSegment,
  createTextSegment,
  type AgentChatComposerDraft,
} from "./agent-chat-composer-draft";
import { buildFileSearchResult } from "./agent-chat-test-fixtures";
import { handleComposerEditorKeyDown } from "./agent-chat-composer-editor-keydown";
import type { FileMenuState } from "./use-agent-chat-composer-editor-autocomplete";
import type {
  ActiveTextSelection,
  TextSelectionTarget,
} from "./use-agent-chat-composer-editor-selection";

type KeyDownTestSetupOverrides = {
  sourceDraft?: AgentChatComposerDraft;
  activeSelection?: ActiveTextSelection | null;
  fileMenuState?: FileMenuState | null;
  slashMenuState?: {
    query: string;
    textSegmentId: string;
    rangeStart: number;
    rangeEnd: number;
  } | null;
  filteredSlashCommands?: AgentSlashCommand[];
  activeSlashIndex?: number;
  activeFileIndex?: number;
  disabled?: boolean;
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  repairedSelection?: ActiveTextSelection | null;
  lineBreakTarget?: TextSelectionTarget | null;
  selectComposerContents?: boolean;
  isComposerContentFullySelected?: boolean;
  applyEditResult?: boolean;
};

const slashCommand: AgentSlashCommand = {
  id: "compact",
  trigger: "compact",
  title: "Compact",
  description: "Compact the session",
  hints: ["compact"],
};

const slashCommandTwo: AgentSlashCommand = {
  id: "summarize",
  trigger: "summarize",
  title: "Summarize",
  description: "Summarize the thread",
  hints: ["summary"],
};

const createActiveSelection = (
  overrides: Partial<ActiveTextSelection> = {},
): ActiveTextSelection => ({
  segmentId: "segment-1",
  element: document.createElement("div"),
  text: "hello",
  caretOffset: 5,
  ...overrides,
});

const createDraft = (text = "hello", segmentId = "segment-1"): AgentChatComposerDraft => ({
  segments: [createTextSegment(text, segmentId)],
  attachments: [],
});

const createKeyDownTestSetup = (overrides: KeyDownTestSetupOverrides = {}) => {
  const root = document.createElement("div") as HTMLDivElement;
  const event = {
    key: overrides.key ?? "Enter",
    shiftKey: overrides.shiftKey ?? false,
    metaKey: overrides.metaKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    preventDefault: mock(() => {}),
  } as unknown as React.KeyboardEvent<HTMLDivElement>;
  const lineBreakTarget = overrides.lineBreakTarget ?? { segmentId: "segment-1", offset: 5 };
  const repairedSelection = overrides.repairedSelection ?? null;
  const sourceDraft = overrides.sourceDraft ?? createDraft();

  const selection = {
    resolveActiveTextSelection: mock(() => repairedSelection),
    resolveSelectionTargetForLineBreak: mock(() => lineBreakTarget),
    focusTextSegmentWithMemory: mock(() => true),
  };
  const selectComposerContents = mock(() => overrides.selectComposerContents ?? true);
  const isComposerContentFullySelected = mock(
    () => overrides.isComposerContentFullySelected ?? false,
  );
  const moveActiveFileIndex = mock(() => false);
  const moveActiveSlashIndex = mock(() => false);
  const closeSlashMenu = mock(() => {});
  const closeFileMenu = mock(() => {});
  const onSend = mock(() => {});
  const clearComposerContents = mock(() => true);
  const insertNewlineAtSelectionTarget = mock(() => true);
  const selectSlashCommand = mock(() => {});
  const selectFileSearchResult = mock(() => {});
  const applyEditResult = mock(() => overrides.applyEditResult ?? true);

  return {
    event,
    selection,
    moveActiveFileIndex,
    moveActiveSlashIndex,
    closeSlashMenu,
    closeFileMenu,
    onSend,
    clearComposerContents,
    insertNewlineAtSelectionTarget,
    selectSlashCommand,
    selectFileSearchResult,
    applyEditResult,
    selectComposerContents,
    isComposerContentFullySelected,
    handled: () =>
      handleComposerEditorKeyDown({
        event,
        root,
        sourceDraft,
        activeSelection: overrides.activeSelection ?? null,
        disabled: overrides.disabled ?? false,
        selection,
        selectComposerContents,
        isComposerContentFullySelected,
        fileMenuState: overrides.fileMenuState ?? null,
        slashMenuState: overrides.slashMenuState ?? null,
        filteredSlashCommands: overrides.filteredSlashCommands ?? [slashCommand],
        activeSlashIndex: overrides.activeSlashIndex ?? 0,
        activeFileIndex: overrides.activeFileIndex ?? 0,
        moveActiveFileIndex,
        moveActiveSlashIndex,
        closeSlashMenu,
        closeFileMenu,
        onSend,
        clearComposerContents,
        insertNewlineAtSelectionTarget,
        selectSlashCommand,
        selectFileSearchResult,
        applyEditResult,
      }),
  };
};

describe("agent-chat-composer-editor-keydown", () => {
  test("prefers file-menu selection over send on enter", () => {
    const results = [
      buildFileSearchResult({ path: "src/a.ts", name: "a.ts" }),
      buildFileSearchResult({ path: "src/b.ts", name: "b.ts" }),
    ];
    const setup = createKeyDownTestSetup({
      fileMenuState: {
        query: "b",
        textSegmentId: "segment-1",
        rangeStart: 0,
        rangeEnd: 2,
        results,
        isLoading: false,
        error: null,
      },
      activeFileIndex: 1,
    });

    expect(setup.handled()).toBe(true);
    expect(setup.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.selectFileSearchResult).toHaveBeenCalledWith(results[1]);
    expect(setup.onSend).not.toHaveBeenCalled();
  });

  test("prefers slash-menu selection over send on enter", () => {
    const setup = createKeyDownTestSetup({
      slashMenuState: {
        query: "sum",
        textSegmentId: "segment-1",
        rangeStart: 0,
        rangeEnd: 4,
      },
      filteredSlashCommands: [slashCommand, slashCommandTwo],
      activeSlashIndex: 1,
    });

    expect(setup.handled()).toBe(true);
    expect(setup.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.selectSlashCommand).toHaveBeenCalledWith(slashCommandTwo);
    expect(setup.onSend).not.toHaveBeenCalled();
  });

  test("inserts a newline from shift-enter using the resolved line-break target", () => {
    const lineBreakTarget = { segmentId: "segment-1", offset: 2 };
    const activeSelection = createActiveSelection({ caretOffset: 2 });
    const setup = createKeyDownTestSetup({
      key: "Enter",
      shiftKey: true,
      activeSelection,
      lineBreakTarget,
    });

    expect(setup.handled()).toBe(true);
    expect(setup.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.selection.resolveSelectionTargetForLineBreak).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ segments: expect.any(Array) }),
      activeSelection,
    );
    expect(setup.insertNewlineAtSelectionTarget).toHaveBeenCalledWith(lineBreakTarget);
    expect(setup.onSend).not.toHaveBeenCalled();
  });

  test("removes an adjacent file chip when backspace hits the start of the trailing text", () => {
    const file = buildFileSearchResult({ path: "src/main.ts", name: "main.ts" });
    const sourceDraft: AgentChatComposerDraft = {
      segments: [
        createTextSegment("", "segment-1"),
        createFileReferenceSegment(file, "file-1"),
        createTextSegment("", "segment-2"),
      ],
      attachments: [],
    };
    const repairedSelection = createActiveSelection({
      segmentId: "segment-2",
      text: "",
      caretOffset: 0,
    });
    const setup = createKeyDownTestSetup({
      key: "Backspace",
      sourceDraft,
      repairedSelection,
    });

    expect(setup.handled()).toBe(true);
    expect(setup.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.applyEditResult).toHaveBeenCalledWith(
      expect.objectContaining({ focusTarget: expect.any(Object), draft: expect.any(Object) }),
    );
    expect(setup.closeSlashMenu).toHaveBeenCalledTimes(1);
    expect(setup.closeFileMenu).toHaveBeenCalledTimes(1);
  });

  test("preserves focus on empty-composer backspace when nothing meaningful remains", () => {
    const sourceDraft = createDraft("", "segment-1");
    const repairedSelection = createActiveSelection({
      segmentId: "segment-1",
      text: "",
      caretOffset: 0,
    });
    const setup = createKeyDownTestSetup({
      key: "Backspace",
      sourceDraft,
      repairedSelection,
    });

    expect(setup.handled()).toBe(true);
    expect(setup.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.selection.focusTextSegmentWithMemory).toHaveBeenCalledWith(
      "segment-1",
      0,
      sourceDraft,
    );
    expect(setup.applyEditResult).not.toHaveBeenCalled();
  });

  test("clears the composer when backspace hits a full-content selection", () => {
    const setup = createKeyDownTestSetup({
      key: "Backspace",
      isComposerContentFullySelected: true,
    });

    expect(setup.handled()).toBe(true);
    expect(setup.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.clearComposerContents).toHaveBeenCalledTimes(1);
    expect(setup.selection.resolveActiveTextSelection).not.toHaveBeenCalled();
  });
});
