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
  sessionRuntimeDataError: null,
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

    await act(async () => {
      await harness.mount();
    });
    expect(harness.getLatest().showThinkingMessages).toBe(true);

    await act(async () => {
      await harness.update(createHookArgs(false));
    });
    expect(harness.getLatest().showThinkingMessages).toBe(false);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("forwards isSessionWorking into the thread model", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      isSessionWorking: true,
    });

    await act(async () => {
      await harness.mount();
    });
    expect(harness.getLatest().isSessionWorking).toBe(true);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("forwards readiness state into the thread model", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      agentStudioReadinessState: "blocked",
      agentStudioReady: false,
      agentStudioBlockedReason: "Runtime unavailable",
    });

    await act(async () => {
      await harness.mount();
    });
    expect(harness.getLatest().readinessState).toBe("blocked");
    expect(harness.getLatest().blockedReason).toBe("Runtime unavailable");

    await act(async () => {
      await harness.unmount();
    });
  });

  test("forwards runtime-waiting separately from history loading", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      agentStudioReadinessState: "checking",
      agentStudioReady: false,
      isWaitingForRuntimeReadiness: true,
      isSessionHistoryLoading: false,
    });

    await act(async () => {
      await harness.mount();
    });
    expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);
    expect(harness.getLatest().isSessionHistoryLoading).toBe(false);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("forwards session runtime data errors into the thread model", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      sessionRuntimeDataError:
        "Runtime connection type 'stdio' is unsupported for active session runtime data access in runtime 'opencode'; local_http is required.",
    });

    await act(async () => {
      await harness.mount();
    });
    expect(harness.getLatest().sessionRuntimeDataError).toContain("local_http is required");

    await act(async () => {
      await harness.unmount();
    });
  });
});

describe("useAgentStudioComposerModel", () => {
  test("appends pending inline comments to the outgoing draft and marks them sent on success", async () => {
    await act(async () => {
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

    await act(async () => {
      await harness.mount();
    });
    expect(harness.getLatest().pendingInlineCommentCount).toBe(1);

    await harness.run((model) => {
      void model.onSend(createEmptyComposerDraft());
    });

    expect(sentDrafts).toHaveLength(1);
    expect(sentDrafts[0]).toContain("## Git Diff Comments");
    expect(sentDrafts[0]).toContain("File: `src/example.ts`");
    expect(sentDrafts[0]).toContain("Diff: uncommitted changes");
    expect(sentDrafts[0]).toContain("Change: added");
    expect(sentDrafts[0]).toContain("Instruction: Please tighten the null handling");
    expect(useInlineCommentDraftStore.getState().getDraftCount()).toBe(0);
    expect(useInlineCommentDraftStore.getState().drafts).toEqual([]);

    await act(async () => {
      await harness.unmount();
    });
    resetInlineComments();
  });

  test("locks the submitted comment snapshot while send is pending and clears it on success", async () => {
    let commentId = "";
    await act(async () => {
      resetInlineComments();
      useInlineCommentDraftStore.getState().resetForContext("draft-1");
      commentId = useInlineCommentDraftStore.getState().addDraft({
        filePath: "src/example.ts",
        diffScope: "uncommitted",
        startLine: 2,
        endLine: 3,
        side: "new",
        text: "Initial pending comment",
        codeContext: [{ lineNumber: 2, text: "target", isSelected: true }],
        language: "ts",
      });
    });

    let resolveSend: ((value: boolean) => void) | null = null;
    const sentDrafts: string[] = [];
    const harness = createComposerHookHarness(
      createComposerHookArgs({
        onSend: async (draft) => {
          sentDrafts.push(draftToSerializedText(draft));
          return await new Promise<boolean>((resolve) => {
            resolveSend = resolve;
          });
        },
      }),
    );

    await act(async () => {
      await harness.mount();
    });
    let sendPromise: Promise<boolean> | null = null;
    await harness.run((model) => {
      sendPromise = model.onSend(createEmptyComposerDraft());
    });

    expect(
      useInlineCommentDraftStore.getState().drafts.filter((draft) => draft.status === "submitting"),
    ).toHaveLength(1);

    expect(() =>
      useInlineCommentDraftStore
        .getState()
        .updateDraft(commentId, "Edited after the send snapshot was captured"),
    ).toThrow("Cannot edit a git diff comment while it is being sent.");

    if (resolveSend == null) {
      throw new Error("Expected pending send resolver");
    }

    await act(async () => {
      resolveSend?.(true);
      await sendPromise;
    });

    expect(sentDrafts[0]).toContain("Initial pending comment");
    expect(sentDrafts[0]).not.toContain("Edited after the send snapshot was captured");
    expect(useInlineCommentDraftStore.getState().drafts).toEqual([]);

    await act(async () => {
      await harness.unmount();
    });
    resetInlineComments();
  });

  test("preserves submitting inline comments when the draft key switches from new to session id", async () => {
    await act(async () => {
      resetInlineComments();
      useInlineCommentDraftStore.getState().resetForContext("task-1:build:new:0");
      useInlineCommentDraftStore.getState().addDraft({
        filePath: "src/example.ts",
        diffScope: "uncommitted",
        startLine: 4,
        endLine: 4,
        side: "new",
        text: "Keep during first-send session switch",
        codeContext: [{ lineNumber: 4, text: "target", isSelected: true }],
        language: "ts",
      });
    });

    let resolveSend: ((value: boolean) => void) | null = null;
    const harness = createComposerHookHarness(
      createComposerHookArgs({
        draftStateKey: "task-1:build:new:0",
        onSend: async () =>
          await new Promise<boolean>((resolve) => {
            resolveSend = resolve;
          }),
      }),
    );

    await act(async () => {
      await harness.mount();
    });

    let sendPromise: Promise<boolean> | null = null;
    await harness.run((model) => {
      sendPromise = model.onSend(createEmptyComposerDraft());
    });

    expect(useInlineCommentDraftStore.getState().drafts[0]?.status).toBe("submitting");

    await act(async () => {
      await harness.update(
        createComposerHookArgs({
          draftStateKey: "task-1:build:session-1:0",
          onSend: async () =>
            await new Promise<boolean>((resolve) => {
              resolveSend = resolve;
            }),
        }),
      );
    });

    expect(useInlineCommentDraftStore.getState().drafts).toHaveLength(1);
    expect(useInlineCommentDraftStore.getState().drafts[0]?.status).toBe("submitting");
    expect(useInlineCommentDraftStore.getState().draftStateKey).toBe("task-1:build:session-1:0");

    if (resolveSend == null) {
      throw new Error("Expected pending send resolver");
    }

    await act(async () => {
      resolveSend?.(false);
      await sendPromise;
    });

    expect(useInlineCommentDraftStore.getState().drafts).toHaveLength(1);
    expect(useInlineCommentDraftStore.getState().drafts[0]?.status).toBe("pending");

    await act(async () => {
      await harness.unmount();
    });
    resetInlineComments();
  });

  test("keeps pending inline comments when send fails or the draft context changes", async () => {
    await act(async () => {
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
    });

    const harness = createComposerHookHarness(
      createComposerHookArgs({
        onSend: async () => false,
      }),
    );

    await act(async () => {
      await harness.mount();
    });
    await harness.run((model) => {
      void model.onSend(createEmptyComposerDraft());
    });
    expect(useInlineCommentDraftStore.getState().getDraftCount()).toBe(1);
    expect(useInlineCommentDraftStore.getState().drafts[0]?.status).toBe("pending");

    await act(async () => {
      await harness.update(
        createComposerHookArgs({
          onSend: async () => false,
          draftStateKey: "draft-2",
        }),
      );
    });
    expect(useInlineCommentDraftStore.getState().drafts).toEqual([]);

    await act(async () => {
      await harness.unmount();
    });
    resetInlineComments();
  });

  test("does not re-append already-submitting comments during a queueable follow-up send", async () => {
    await act(async () => {
      resetInlineComments();
      useInlineCommentDraftStore.getState().resetForContext("draft-1");
      useInlineCommentDraftStore.getState().addDraft({
        filePath: "src/example-a.ts",
        diffScope: "uncommitted",
        startLine: 2,
        endLine: 2,
        side: "new",
        text: "First batch comment",
        codeContext: [{ lineNumber: 2, text: "target-a", isSelected: true }],
        language: "ts",
      });
    });

    const sentDrafts: string[] = [];
    const resolvers: Array<(value: boolean) => void> = [];
    const harness = createComposerHookHarness(
      createComposerHookArgs({
        isSending: true,
        isSessionWorking: true,
        onSend: async (draft) => {
          sentDrafts.push(draftToSerializedText(draft));
          return await new Promise<boolean>((resolve) => {
            resolvers.push(resolve);
          });
        },
      }),
    );

    await act(async () => {
      await harness.mount();
    });
    let firstSendPromise: Promise<boolean> | null = null;
    await harness.run((model) => {
      firstSendPromise = model.onSend(createEmptyComposerDraft());
    });

    await act(async () => {
      useInlineCommentDraftStore.getState().addDraft({
        filePath: "src/example-b.ts",
        diffScope: "target",
        startLine: 5,
        endLine: 5,
        side: "old",
        text: "Second batch comment",
        codeContext: [{ lineNumber: 5, text: "target-b", isSelected: true }],
        language: "ts",
      });
    });

    let secondSendPromise: Promise<boolean> | null = null;
    await harness.run((model) => {
      secondSendPromise = model.onSend(createEmptyComposerDraft());
    });

    expect(sentDrafts).toHaveLength(2);
    expect(sentDrafts[0]).toContain("First batch comment");
    expect(sentDrafts[0]).not.toContain("Second batch comment");
    expect(sentDrafts[1]).toContain("Second batch comment");
    expect(sentDrafts[1]).not.toContain("First batch comment");

    await act(async () => {
      resolvers[0]?.(true);
      resolvers[1]?.(true);
      await Promise.all([firstSendPromise, secondSendPromise]);
    });

    expect(useInlineCommentDraftStore.getState().drafts).toEqual([]);

    await act(async () => {
      await harness.unmount();
    });
    resetInlineComments();
  });
});
