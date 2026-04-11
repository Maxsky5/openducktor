import { describe, expect, test } from "bun:test";
import { act, createRef } from "react";
import {
  createEmptyComposerDraft,
  draftToSerializedText,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  useAgentStudioComposerModel,
  useAgentStudioThreadModel,
} from "./use-agent-studio-page-submodels";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioThreadModel>[0];
type ComposerHookArgs = Parameters<typeof useAgentStudioComposerModel>[0];

const resetInlineComments = (): void => {
  useInlineCommentDraftStore.setState({ drafts: [], draftStateKey: null });
};

const createHookArgs = (showThinkingMessages = false): HookArgs => ({
  threadSession: null,
  isSessionWorking: false,
  showThinkingMessages,
  isContextSwitching: false,
  isSessionHistoryLoading: false,
  isWaitingForRuntimeReadiness: false,
  taskId: "task-1",
  activeSessionAgentColors: {},
  agentStudioReadinessState: "ready",
  agentStudioReady: true,
  agentStudioBlockedReason: "",
  isLoadingChecks: false,
  refreshChecks: async () => {},
  canKickoffNewSession: true,
  selectedRoleAvailable: true,
  kickoffLabel: "Start",
  startScenarioKickoff: async () => {},
  isStarting: false,
  isSending: false,
  isSubmittingQuestionByRequestId: {},
  onSubmitQuestionAnswers: async () => {},
  isSubmittingPermissionByRequestId: {},
  permissionReplyErrorByRequestId: {},
  onReplyPermission: async () => {},
  todoPanelCollapsed: false,
  onToggleTodoPanel: () => {},
  messagesContainerRef: createRef<HTMLDivElement>(),
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioThreadModel, initialProps);

const createComposerHookArgs = (overrides: Partial<ComposerHookArgs> = {}): ComposerHookArgs => ({
  taskId: "task-1",
  activeSession: {
    sessionId: "session-1",
    selectedModel: null,
    isLoadingModelCatalog: false,
    pendingPermissions: [],
    pendingQuestions: [],
  },
  isSessionWorking: false,
  isWaitingInput: false,
  busySendBlockedReason: null,
  canStopSession: true,
  stopAgentSession: async () => {},
  agentStudioReady: true,
  selectedRoleAvailable: true,
  selectedRoleReadOnlyReason: null,
  draftStateKey: "draft-1",
  onSend: async () => true,
  isSending: false,
  isStarting: false,
  chatContextUsage: null,
  selectedModelSelection: null,
  selectedModelDescriptor: null,
  isSelectionCatalogLoading: false,
  supportsSlashCommands: true,
  supportsFileSearch: true,
  slashCommandCatalog: { commands: [] },
  slashCommands: [],
  slashCommandsError: null,
  isSlashCommandsLoading: false,
  searchFiles: async () => [],
  agentOptions: [],
  modelOptions: [],
  modelGroups: [],
  variantOptions: [],
  onSelectAgent: () => {},
  onSelectModel: () => {},
  onSelectVariant: () => {},
  activeSessionAgentColors: {},
  composerFormRef: createRef<HTMLFormElement>(),
  composerEditorRef: createRef<HTMLDivElement>(),
  resizeComposerEditor: () => {},
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
  ...overrides,
});

const createComposerHookHarness = (initialProps: ComposerHookArgs) =>
  createSharedHookHarness(useAgentStudioComposerModel, initialProps);

describe("useAgentStudioThreadModel", () => {
  test("forwards showThinkingMessages into the thread model", async () => {
    const harness = createHookHarness(createHookArgs(true));

    await harness.mount();
    expect(harness.getLatest().showThinkingMessages).toBe(true);

    await harness.update(createHookArgs(false));
    expect(harness.getLatest().showThinkingMessages).toBe(false);

    await harness.unmount();
  });

  test("forwards isSessionWorking into the thread model", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      isSessionWorking: true,
    });

    await harness.mount();
    expect(harness.getLatest().isSessionWorking).toBe(true);

    await harness.unmount();
  });

  test("forwards readiness state into the thread model", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      agentStudioReadinessState: "blocked",
      agentStudioReady: false,
      agentStudioBlockedReason: "Runtime unavailable",
    });

    await harness.mount();
    expect(harness.getLatest().readinessState).toBe("blocked");
    expect(harness.getLatest().blockedReason).toBe("Runtime unavailable");

    await harness.unmount();
  });

  test("forwards runtime-waiting separately from history loading", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      agentStudioReadinessState: "checking",
      agentStudioReady: false,
      isWaitingForRuntimeReadiness: true,
      isSessionHistoryLoading: false,
    });

    await harness.mount();
    expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);
    expect(harness.getLatest().isSessionHistoryLoading).toBe(false);

    await harness.unmount();
  });
});

describe("useAgentStudioComposerModel", () => {
  test("appends pending inline comments to the outgoing draft and marks them sent on success", async () => {
    resetInlineComments();
    useInlineCommentDraftStore.getState().resetForContext("draft-1");
    useInlineCommentDraftStore.getState().addDraft({
      filePath: "src/example.ts",
      diffScope: "uncommitted",
      startLine: 2,
      endLine: 3,
      side: "new",
      text: "Please tighten the null handling",
      codeContext: [
        { lineNumber: 1, text: "before", isSelected: false },
        { lineNumber: 2, text: "target", isSelected: true },
      ],
      language: "ts",
    });

    const sentDrafts: string[] = [];
    const harness = createComposerHookHarness(
      createComposerHookArgs({
        onSend: async (draft) => {
          sentDrafts.push(draftToSerializedText(draft));
          return true;
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().pendingInlineCommentCount).toBe(1);

    await act(async () => {
      await harness.getLatest().onSend(createEmptyComposerDraft());
    });

    expect(sentDrafts).toHaveLength(1);
    expect(sentDrafts[0]).toContain("## Git Diff Comments");
    expect(sentDrafts[0]).toContain("File: `src/example.ts`");
    expect(useInlineCommentDraftStore.getState().getDraftCount()).toBe(0);
    expect(useInlineCommentDraftStore.getState().drafts[0]?.status).toBe("sent");

    await harness.unmount();
    resetInlineComments();
  });

  test("keeps pending inline comments when send fails or the draft context changes", async () => {
    resetInlineComments();
    useInlineCommentDraftStore.getState().resetForContext("draft-1");
    useInlineCommentDraftStore.getState().addDraft({
      filePath: "src/example.ts",
      diffScope: "target",
      startLine: 8,
      endLine: 8,
      side: "old",
      text: "Keep this pending",
      codeContext: [{ lineNumber: 8, text: "old line", isSelected: true }],
      language: "ts",
    });

    const harness = createComposerHookHarness(
      createComposerHookArgs({
        onSend: async () => false,
      }),
    );

    await harness.mount();
    await act(async () => {
      await harness.getLatest().onSend(createEmptyComposerDraft());
    });
    expect(useInlineCommentDraftStore.getState().getDraftCount()).toBe(1);
    expect(useInlineCommentDraftStore.getState().drafts[0]?.status).toBe("pending");

    await harness.update(
      createComposerHookArgs({
        onSend: async () => false,
        draftStateKey: "draft-2",
      }),
    );
    expect(useInlineCommentDraftStore.getState().drafts).toEqual([]);

    await harness.unmount();
    resetInlineComments();
  });
});
