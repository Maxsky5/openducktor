import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { type AgentChatComposerDraft, createTextSegment } from "./agent-chat-composer-draft";
import { useAgentChatComposerEditorEvents } from "./use-agent-chat-composer-editor-events";
import type {
  ActiveTextSelection,
  TextSelectionTarget,
} from "./use-agent-chat-composer-editor-selection";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type EventsHookArgs = Parameters<typeof useAgentChatComposerEditorEvents>[0];

type EventsTestSetupOverrides = {
  draft?: AgentChatComposerDraft;
  activeSelection?: ActiveTextSelection | null;
  lineBreakTarget?: TextSelectionTarget | null;
  disabled?: boolean;
};

const createDraft = (text = "hello", segmentId = "segment-1"): AgentChatComposerDraft => ({
  segments: [createTextSegment(text, segmentId)],
  attachments: [],
});

const createActiveSelection = (
  overrides: Partial<ActiveTextSelection> = {},
): ActiveTextSelection => ({
  segmentId: "segment-1",
  element: document.createElement("div"),
  text: "hello",
  caretOffset: 5,
  ...overrides,
});

const createBeforeInputEvent = (
  root: HTMLDivElement,
  inputType: string,
  data: string | null = null,
) => {
  return {
    currentTarget: root,
    target: root,
    preventDefault: mock(() => {}),
    nativeEvent: {
      inputType,
      data,
    },
  } as unknown as React.FormEvent<HTMLDivElement>;
};

const createPasteEvent = (root: HTMLDivElement, file: File) => {
  return {
    currentTarget: root,
    target: root,
    preventDefault: mock(() => {}),
    clipboardData: {
      items: [
        {
          kind: "file",
          type: file.type,
          getAsFile: () => file,
        },
      ],
      files: [file],
      types: ["Files"],
      getData: mock(() => ""),
    },
  } as unknown as React.ClipboardEvent<HTMLDivElement>;
};

const createEventsTestSetup = (overrides: EventsTestSetupOverrides = {}) => {
  const root = document.createElement("div") as HTMLDivElement;
  const sourceDraft = overrides.draft ?? createDraft();
  const activeSelection = overrides.activeSelection ?? createActiveSelection();
  const lineBreakTarget = overrides.lineBreakTarget ?? { segmentId: "segment-1", offset: 5 };
  const latestDraftRef = { current: sourceDraft };

  const selection: EventsHookArgs["selection"] = {
    rememberSelectionTarget: mock(() => {}),
    getRememberedSelectionTarget: mock(() => null),
    setPendingInputState: mock(() => {}),
    getPendingInputState: mock(() => null),
    clearPendingInputState: mock(() => {}),
    focusTextSegment: mock(() => true),
    setPendingFocusTarget: mock(() => {}),
    resolveActiveTextSelection: mock(() => activeSelection),
    resolveActiveTextSelectionRange: mock(() => null),
    resolveSelectionTargetForLineBreak: mock(() => lineBreakTarget),
    focusTextSegmentWithMemory: mock(() => true),
  };

  const onDraftChange = mock(() => {});
  const onEditorInput = mock(() => {});
  const onAddFiles = mock(() => {});
  const onSend = mock(() => {});
  const closeSlashMenu = mock(() => {});
  const closeReferenceMenu = mock(() => {});
  const closeSkillMenu = mock(() => {});
  const syncMenusForSelectionTarget = mock(() => {});
  const moveActiveReferenceIndex = mock(() => false);
  const moveActiveSlashIndex = mock(() => false);
  const moveActiveSkillIndex = mock(() => false);
  const applyEditResult = mock(() => true);
  const clearComposerContents = mock(() => true);
  const insertNewlineAtSelectionTarget = mock(() => true);
  const selectSlashCommand = mock(() => {});
  const selectSkillReference = mock(() => {});
  const selectSubagentReference = mock(() => {});
  const selectFileSearchResult = mock(() => {});

  const args: EventsHookArgs = {
    disabled: overrides.disabled ?? false,
    onDraftChange,
    onEditorInput,
    onAddFiles,
    onSend,
    latestDraftRef,
    selection,
    slashMenuState: null,
    referenceMenuState: null,
    skillMenuState: null,
    filteredSlashCommands: [],
    filteredSkills: [],
    referenceMenuItems: [],
    activeSlashIndex: 0,
    activeSkillIndex: 0,
    activeReferenceIndex: 0,
    closeSlashMenu,
    closeReferenceMenu,
    closeSkillMenu,
    syncMenusForSelectionTarget,
    moveActiveReferenceIndex,
    moveActiveSlashIndex,
    moveActiveSkillIndex,
    applyEditResult,
    clearComposerContents,
    insertNewlineAtSelectionTarget,
    selectSlashCommand,
    selectSkillReference,
    selectSubagentReference,
    selectFileSearchResult,
  };

  const harness = createHookHarness(
    (props: EventsHookArgs) => useAgentChatComposerEditorEvents(props),
    args,
  );

  return {
    harness,
    root,
    sourceDraft,
    activeSelection,
    lineBreakTarget,
    selection,
    onDraftChange,
    onEditorInput,
    onAddFiles,
    closeSlashMenu,
    closeReferenceMenu,
    closeSkillMenu,
    insertNewlineAtSelectionTarget,
  };
};

describe("useAgentChatComposerEditorEvents", () => {
  test("intercepts beforeinput line breaks and routes them through draft insertion", async () => {
    const setup = createEventsTestSetup({
      activeSelection: createActiveSelection({ caretOffset: 2 }),
      lineBreakTarget: { segmentId: "segment-1", offset: 2 },
    });
    await setup.harness.mount();

    const event = createBeforeInputEvent(setup.root, "insertLineBreak");

    await setup.harness.run((state) => {
      state.handleEditorBeforeInput(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.selection.rememberSelectionTarget).toHaveBeenCalledWith(setup.sourceDraft, {
      segmentId: "segment-1",
      offset: 2,
    });
    expect(setup.selection.setPendingInputState).toHaveBeenCalledWith({
      segmentId: "segment-1",
      offset: 2,
      inputType: "insertLineBreak",
      data: null,
    });
    expect(setup.closeSlashMenu).toHaveBeenCalledTimes(1);
    expect(setup.closeReferenceMenu).toHaveBeenCalledTimes(1);
    expect(setup.closeSkillMenu).toHaveBeenCalledTimes(1);
    expect(setup.selection.resolveSelectionTargetForLineBreak).toHaveBeenCalledWith(
      setup.root,
      setup.sourceDraft,
      setup.activeSelection,
    );
    expect(setup.insertNewlineAtSelectionTarget).toHaveBeenCalledWith({
      segmentId: "segment-1",
      offset: 2,
    });

    await setup.harness.unmount();
  });

  test("treats pasted images as attachments and skips text editing", async () => {
    const setup = createEventsTestSetup();
    await setup.harness.mount();

    const file = new File(["image"], "pasted-image.png", { type: "image/png" });
    const event = createPasteEvent(setup.root, file);

    await setup.harness.run((state) => {
      state.handleEditorPaste(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setup.selection.clearPendingInputState).toHaveBeenCalledTimes(1);
    expect(setup.closeSlashMenu).toHaveBeenCalledTimes(1);
    expect(setup.closeReferenceMenu).toHaveBeenCalledTimes(1);
    expect(setup.closeSkillMenu).toHaveBeenCalledTimes(1);
    expect(setup.onAddFiles).toHaveBeenCalledWith([file]);
    expect(setup.onDraftChange).not.toHaveBeenCalled();
    expect(setup.onEditorInput).not.toHaveBeenCalled();
    expect(setup.selection.resolveActiveTextSelection).not.toHaveBeenCalled();

    await setup.harness.unmount();
  });
});
