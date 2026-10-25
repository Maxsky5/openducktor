import { MemoryRouter } from "react-router";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { expect, mock, spyOn, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_CHAT_SETTINGS,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { act, type ReactElement, type ReactNode, useState } from "react";
import { fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { useIsFetching } from "@tanstack/react-query";
import * as messageContent from "@/components/features/agents/agent-chat/agent-chat-message-card-content";
import { buildMessage } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import * as modelPickerModel from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { QueryProvider } from "@/test-utils/query-provider";
import type { HostClient } from "@openducktor/host-client";
import type { AttachmentStager } from "@openducktor/frontend-core/platform/device-file";
import { createBrowserAttachmentStager } from "@/lib/local-attachment-files";
import {
  createTestClientConnection,
  type TestClientConnectionOptions,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { createAgentMessageQueuesStore } from "@openducktor/frontend-core/sessions/agent-message-queues-store";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { toInlineCommentDraftStorageKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-storage";
import { toBrowserAnnotationOwnerKey } from "@/features/browser-annotations";
import { browserAnnotationStoreOf } from "@/features/browser-annotations/browser-annotation-store";
import { buildCapture } from "@/features/browser-annotations/browser-annotation-test-support";
import { createSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import { loadSessionHistoryIntoStore } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/session-history-loader";
import { createSessionHistoryReadGeneration } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/session-history-read-generation";
import {
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  AgentMessageQueuesContext,
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  HostRuntimeStatusContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentMessageSendReceipt } from "@openducktor/frontend-core/test-support/agent-message-send-fixture";
import {
  createAgentSessionFixture,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
} from "@/types/state-slices";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import { WorkspaceSessionChat } from "./workspace-session-chat";
import { WorkspaceSessionChatPane } from "./workspace-session-chat-pane";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import {
  buildApprovalRequest,
  buildQuestionRequest,
} from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import { createWorkspaceSessionChatDraftPersistence } from "@openducktor/frontend-core/sessions/composer/workspace-session-chat-draft";
import { createTextSegment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { typeIntoComposer } from "@/components/features/agents/agent-chat/agent-chat-composer-test-helpers";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import { useAgentMessageSendPolicy } from "@openducktor/frontend-core/sessions/send/use-agent-message-send-policy";
import { useAgentChatSendForTarget } from "@openducktor/frontend-core/test-support/agent-chat-send-fixture";
import { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";
import { createComposerAttachment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";

function preparedChatClient(entry: WorkspaceSession, session: AgentSessionState) {
  return {
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    workspaceSessionStart: async () => ({
      session: { ...entry, externalSessionId: session.externalSessionId },
      runtimeSession: {
        externalSessionId: session.externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
        startedAt: session.startedAt,
        status: session.status,
      },
    }),
  };
}

function QueryStatus() {
  const pending = useIsFetching();
  return (
    <output aria-label="Pending queries" hidden>
      {pending}
    </output>
  );
}

test.each(["local_repo_root", "local_worktree"] as const)(
  "sends both diff scopes and annotations from a prepared %s chat",
  async (kind) => {
    const workspace = {
      workspaceId: `comment-chat-${kind}`,
      workspaceName: "Test",
      repoPath: "/repo",
    };
    const executionTarget: WorkspaceSession["executionTarget"] =
      kind === "local_repo_root"
        ? { kind, workingDirectory: "/repo" }
        : {
            kind,
            workingDirectory: "/repo/worktrees/comments",
            branchName: "comments",
            worktreeState: "present",
          };
    const entry: WorkspaceSession = {
      id: "draft-comments",
      runtimeKind: "opencode",
      externalSessionId: "native-comments",
      executionTarget,
      selectedModel: null,
      roleSnapshot: null,
      generatedTitle: null,
      manualTitle: null,
      targetBranch: null,
      createdAt: 1000,
      updatedAt: 1000,
      archivedAt: null,
    };
    const session = createAgentSessionFixture({
      runtimeKind: entry.runtimeKind,
      externalSessionId: "native-comments",
      workingDirectory: executionTarget.workingDirectory,
      sessionAssociation: { kind: "repository" },
      historyLoadState: "loaded",
      status: "idle",
    });
    const store = createAgentSessionsStore(workspace.repoPath);
    store.replaceSession(session);
    const sends: Parameters<AgentOperationsContextValue["sendAgentMessage"]>[] = [];
    const ownerKey = toInlineCommentDraftStorageKey({
      workspaceId: workspace.workspaceId,
      workspaceSessionId: entry.id,
    });
    const annotationOwner = {
      kind: "workspace_session" as const,
      workspaceId: workspace.workspaceId,
      sessionId: entry.id,
    };
    const annotationKey = toBrowserAnnotationOwnerKey(annotationOwner);
    if (!annotationKey) throw new Error("Expected an annotation owner key");
    const [element] = buildCapture().elements;
    if (!element) throw new Error("Expected an element fixture");
    const { Harness, connection } = createWorkspaceChatHarness({
      workspace,
      entry,
      session,
      store,
      scenario: "draft",
      counters: { runtimeReads: 0, baselineLoads: 0, revalidations: 0 },
      client: preparedChatClient(entry, session),
      sendAgentMessage: async (identity, parts) => {
        sends.push([identity, parts]);
        return createAgentMessageSendReceipt(identity);
      },
    });
    browserAnnotationStoreOf(connection)
      .getState()
      .addAnnotation(annotationKey, {
        capture: buildCapture({
          elements: [
            {
              ...element,
              source: {
                path: `${executionTarget.workingDirectory}/src/header.tsx`,
                line: 3,
                column: null,
              },
            },
          ],
        }),
        comment: "Annotate the header",
        includeScreenshot: false,
      });
    const inlineComments = connection.drafts.inlineComments;
    for (const diffScope of ["uncommitted", "target"] as const) {
      inlineComments.getState().addDraft(ownerKey, {
        filePath: "draft.ts",
        diffScope,
        side: "new",
        startLine: 1,
        endLine: 1,
        text: `Review ${diffScope}`,
        codeContext: [{ lineNumber: 1, text: "const draft = true;", isSelected: true }],
        language: "ts",
      });
    }
    const view = render(<Harness />);
    try {
      const send = await view.findByRole("button", { name: "Send message" });
      await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));
      await act(async () => {
        fireEvent.click(send);
      });
      await waitFor(() => expect(sends).toHaveLength(1));
      const [sentPart] = sends[0]?.[1] ?? [];
      const sentText = sentPart?.kind === "text" ? sentPart.text : "";
      expect(sentText).toContain("<browser_annotations>");
      expect(sentText).toContain('1. "Annotate the header"');
      expect(sentText).toContain("source: src/header.tsx:3");
      expect(sends[0]?.[1]).toEqual([
        { kind: "text", text: expect.stringContaining("Review uncommitted") },
      ]);
      expect(sends[0]?.[1][0]).toMatchObject({ text: expect.stringContaining("Review target") });
      expect(inlineComments.getState().getDraftCount(ownerKey)).toBe(0);
      expect(
        browserAnnotationStoreOf(connection).getState().getPendingAnnotations(annotationKey),
      ).toEqual([]);
    } finally {
      view.unmount();
    }
  },
  5000,
);

type WorkspaceChatScenario =
  | "retry"
  | "streaming"
  | "draft"
  | "record-failure"
  | "switch-return"
  | "observation-failure";

type WorkspaceChatCounters = {
  runtimeReads: number;
  baselineLoads: number;
  revalidations: number;
};

const createWorkspaceChatHarness = ({
  workspace,
  entry,
  session,
  store,
  scenario,
  counters,
  client,
  stageAttachment,
  sendAgentMessage = async () => {
    throw new Error("Unexpected message send");
  },
}: {
  workspace: ActiveWorkspace;
  entry: WorkspaceSession;
  session: AgentSessionState;
  store: ReturnType<typeof createAgentSessionsStore>;
  scenario: WorkspaceChatScenario;
  counters: WorkspaceChatCounters;
  client?: Partial<HostClient>;
  stageAttachment?: AttachmentStager | undefined;
  sendAgentMessage?: AgentOperationsContextValue["sendAgentMessage"];
}) => {
  const connectionOptions: TestClientConnectionOptions = {
    client: {
      ...preparedChatClient(entry, session),
      ...client,
    },
  };
  if (stageAttachment) connectionOptions.stageAttachment = stageAttachment;
  const connection = createTestClientConnection(connectionOptions);
  const operations = createAgentOperationsFixture({
    readSessionTodos: async () => {
      counters.runtimeReads += 1;
      return [];
    },
    loadAgentSessionHistory: async () => {
      counters.runtimeReads += 1;
      return session;
    },
    loadAgentSessionContext: async () => {
      counters.runtimeReads += 1;
    },
    sendAgentMessage,
  });
  const definitions: RuntimeDefinitionsContextValue = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {} },
      },
    }),
    loadRepoRuntimeFileSearch: async () => [],
  };
  const messageQueues = createAgentMessageQueuesStore();
  let completeObservation = (): void => {};
  let failObservation = (): void => {};
  let observationRetries = 0;

  function Harness({ children }: { children?: ReactNode }): ReactElement {
    const [phase, setPhase] = useState<"fault" | "loading" | "ready">(
      scenario === "retry" || scenario === "record-failure" || scenario === "observation-failure"
        ? "fault"
        : "ready",
    );
    completeObservation = () => setPhase("ready");
    failObservation = () => setPhase("fault");
    const readModel: AgentSessionReadModelStateContextValue = {
      workspaceSessionRecordsError:
        scenario === "record-failure" && phase !== "ready" ? "Chat records failed" : null,
      sessionReadModelLoadState:
        scenario === "observation-failure" && phase === "fault"
          ? {
              kind: "failed",
              workspaceRepoPath: "/repo",
              source: "live-stream",
              message: "Observation failed",
            }
          : {
              kind: phase === "loading" ? "loading" : "ready",
              workspaceRepoPath: "/repo",
            },
      getSessionFault: () =>
        phase === "fault" && scenario === "retry"
          ? { source: "workspace-target", message: "Runtime directory mismatch" }
          : null,
      reloadSessionReadModel: () => {
        observationRetries += 1;
        setPhase("loading");
      },
    };
    return (
      <QueryProvider connection={connection}>
        <MemoryRouter>
          <QueryStatus />
          <RuntimeDefinitionsContext value={definitions}>
            <HostRuntimeStatusContext value={createHostRuntimeStatusContextValue()}>
              <AgentOperationsContext value={operations}>
                <AgentSessionHistoryLoadContext
                  value={{
                    loadAgentSessionHistory: async () => {
                      if (store.getSessionSnapshot(session)?.historyLoadState === "stale")
                        counters.revalidations += 1;
                      else counters.baselineLoads += 1;
                      return session;
                    },
                  }}
                >
                  <AgentSessionReadModelStateContext value={readModel}>
                    <AgentSessionsContext value={store}>
                      <AgentMessageQueuesContext value={messageQueues}>
                        {children ?? (
                          <WorkspaceSessionChat
                            isActive
                            workspace={workspace}
                            record={entry}
                            chatSettings={DEFAULT_CHAT_SETTINGS}
                            reusablePrompts={[]}
                            onToolRefresh={() => {}}
                            isMounted={() => true}
                          />
                        )}
                      </AgentMessageQueuesContext>
                    </AgentSessionsContext>
                  </AgentSessionReadModelStateContext>
                </AgentSessionHistoryLoadContext>
              </AgentOperationsContext>
            </HostRuntimeStatusContext>
          </RuntimeDefinitionsContext>
        </MemoryRouter>
      </QueryProvider>
    );
  }

  return {
    Harness,
    connection,
    operations,
    definitions,
    observationRetries: () => observationRetries,
    completeObservation: () => completeObservation(),
    failObservation: () => failObservation(),
  };
};

const createPresentationScenario = (
  runtimeKind: WorkspaceSession["runtimeKind"] = "opencode",
  messages: AgentSessionState["messages"]["items"] = [],
  stageAttachment?: AttachmentStager,
) => {
  const workspace = { workspaceId: "A", workspaceName: "Test", repoPath: "/repo" };
  const entry: WorkspaceSession = {
    id: "presentation-session",
    runtimeKind,
    externalSessionId: "native-parent",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    targetBranch: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
  const session = createAgentSessionFixture({
    runtimeKind,
    externalSessionId: entry.externalSessionId!,
    workingDirectory: "/repo",
    sessionAssociation: { kind: "repository" },
    historyLoadState: "loaded",
    livePresence: "present",
    status: "idle",
    messages: [...messages],
    pendingApprovals: [],
    pendingQuestions: [],
  });
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(session);
  return {
    workspace,
    entry,
    session,
    store,
    ...createWorkspaceChatHarness({
      workspace,
      entry,
      session,
      store,
      scenario: "streaming",
      counters: { runtimeReads: 0, baselineLoads: 0, revalidations: 0 },
      stageAttachment,
    }),
  };
};

test("keeps Stop available after an unconfirmed termination", async () => {
  const { Harness, session, store, operations } = createPresentationScenario("claude");
  const runningSession = { ...session, status: "running" as const, foregroundTurnActive: false };
  const unavailableReason = "Claude termination is unconfirmed. Retry Stop.";
  store.replaceSession(runningSession);
  const stopAgentSession = mock(async () => {
    store.replaceSession({ ...runningSession, statusUnavailableReason: unavailableReason });
    throw new Error(unavailableReason);
  });
  operations.stopAgentSession = stopAgentSession;
  const view = render(<Harness />);
  try {
    const stop = await view.findByRole("button", { name: "Stop session" });
    await act(async () => fireEvent.click(stop));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe(unavailableReason));
    expect(view.getByLabelText("Message composer").getAttribute("contenteditable")).toBe("false");
    const retryStop = view.getByRole("button", { name: "Stop session" });
    expect(retryStop.hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.click(retryStop));
    expect(stopAgentSession).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
  }
  // The full chat render waits for catalog, history, and runtime reads.
}, 5000);

test("loads scoped Claude history before preparation completes and keeps Send locked", async () => {
  const { Harness, connection, workspace, entry, session, store, definitions, operations } =
    createPresentationScenario("claude");
  definitions.runtimeDefinitions = [CLAUDE_RUNTIME_DESCRIPTOR];
  definitions.availableRuntimeDefinitions = [CLAUDE_RUNTIME_DESCRIPTOR];
  const model = { providerId: "claude", modelId: "claude-haiku-5-5", variant: "low" };
  entry.selectedModel = { ...model, runtimeKind: "claude" };
  const coldSession = {
    ...session,
    historyLoadState: "not_requested" as const,
    selectedModel: model,
    livePresence: "unobserved" as const,
  };
  store.replaceSession(coldSession);
  definitions.loadRepoRuntimeCatalog = async () => ({
    models: {
      status: "available",
      catalog: {
        models: [
          {
            id: "claude/claude-haiku-5-5",
            providerId: "claude",
            providerName: "Claude",
            modelId: "claude-haiku-5-5",
            modelName: "Haiku 5.5",
            variants: ["low"],
          },
        ],
        defaultModelsByProvider: {},
      },
    },
  });
  const preparation = Promise.withResolvers<void>();
  const start = mock(async () => {
    await preparation.promise;
    return preparedChatClient(entry, coldSession).workspaceSessionStart();
  });
  connection.host.client.workspaceSessionStart = start;
  const readHistory = mock(async (_input: LoadAgentSessionHistoryInput) => [
    {
      messageId: "stored-reply",
      role: "assistant" as const,
      timestamp: "2026-10-21T18:21:27.097Z",
      text: "Stored Claude reply",
      parts: [],
    },
  ]);
  const context = spyOn(operations, "loadAgentSessionContext");
  const historyReadGeneration = createSessionHistoryReadGeneration();
  const chat = (visible: boolean) => (
    <Harness>
      <AgentSessionHistoryLoadContext
        value={{
          loadAgentSessionHistory: (identity) =>
            loadSessionHistoryIntoStore({
              repoPath: workspace.repoPath,
              identity,
              adapter: { loadSessionHistory: readHistory },
              readSessionSnapshot: store.getSessionSnapshot,
              updateSession: store.updateSession,
              historyReadGeneration,
              isStaleRepoOperation: () => false,
            }),
        }}
      >
        <SessionViewContext value={{ id: entry.id, isActive: visible }}>
          <WorkspaceSessionChat
            isActive={visible}
            workspace={workspace}
            record={entry}
            chatSettings={DEFAULT_CHAT_SETTINGS}
            reusablePrompts={[]}
            onToolRefresh={() => {}}
            isMounted={() => true}
          />
        </SessionViewContext>
      </AgentSessionHistoryLoadContext>
    </Harness>
  );
  const view = render(chat(false));
  try {
    await waitFor(() => expect(view.getByLabelText("Pending queries").textContent).toBe("0"));
    expect(start).not.toHaveBeenCalled();
    expect(readHistory).not.toHaveBeenCalled();
    view.rerender(chat(true));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readHistory).toHaveBeenCalledTimes(1));
    expect(readHistory.mock.calls[0]?.[0]).toMatchObject({
      repoPath: workspace.repoPath,
      runtimeKind: "claude",
      workingDirectory: coldSession.workingDirectory,
      externalSessionId: coldSession.externalSessionId,
      sessionScope: { kind: "repository" },
      runtimePolicy: { kind: "claude" },
    });
    await view.findByText("Stored Claude reply");
    typeIntoComposer(view.container, "Draft while preparation waits");
    const send = view.getByRole("button", { name: "Send message" });
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(context).not.toHaveBeenCalled();
    await act(async () => preparation.resolve());
    await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));
    expect(view.getByText("Stored Claude reply")).toBeTruthy();
    expect(readHistory).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => preparation.resolve());
    view.unmount();
    context.mockRestore();
  }
});

test.each([OPENCODE_RUNTIME_DESCRIPTOR, CLAUDE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR])(
  "keeps the $kind composer and session settings stable while a selected session prepares",
  async (descriptor) => {
    const { Harness, connection, workspace, entry, session, store, definitions } =
      createPresentationScenario(descriptor.kind);
    definitions.runtimeDefinitions = [descriptor];
    definitions.availableRuntimeDefinitions = [descriptor];
    const selections: NonNullable<WorkspaceSession["selectedModel"]>[] = [
      { runtimeKind: descriptor.kind, providerId: "provider", modelId: "first", variant: "low" },
      {
        runtimeKind: descriptor.kind,
        providerId: "provider",
        modelId: "second",
        variant: "high",
        speed: "fast",
      },
    ];
    entry.selectedModel = selections[0]!;
    session.contextUsage = { totalTokens: 10_000, contextWindow: 100_000 };
    store.replaceSession(session);
    const second = {
      ...entry,
      id: "second-session",
      externalSessionId: "second-native",
      selectedModel: selections[1]!,
    };
    store.replaceSession({
      ...session,
      externalSessionId: second.externalSessionId,
      messages: createSessionMessagesState(second.externalSessionId),
      selectedModel: selections[1]!,
      contextUsage: { totalTokens: 20_000, contextWindow: 100_000 },
    });
    definitions.loadRepoRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: {
          models: ["first", "second"].map((modelId) => ({
            id: `provider/${modelId}`,
            providerId: "provider",
            providerName: "Provider",
            modelId,
            modelName: modelId,
            variants: ["low", "high"],
            speedLevels: [{ id: "fast", label: "Fast" }],
          })),
          defaultModelsByProvider: {},
        },
      },
    });
    const start = mock<ReturnType<typeof preparedChatClient>["workspaceSessionStart"]>(
      () => new Promise(() => {}),
    );
    connection.host.client.workspaceSessionStart = start;
    const chat = (record: WorkspaceSession, visitKey: number) => (
      <Harness>
        <WorkspaceSessionChat
          isActive
          workspace={workspace}
          record={record}
          visitKey={visitKey}
          chatSettings={DEFAULT_CHAT_SETTINGS}
          reusablePrompts={[]}
          onToolRefresh={() => {}}
          isMounted={() => true}
        />
      </Harness>
    );
    const view = render(chat(entry, 0));
    try {
      await view.findByRole("button", { name: `Select model, ${descriptor.label}, first` });
      await waitFor(() => expect(view.getByLabelText("Pending queries").textContent).toBe("0"));
      const editor = view.getByRole("combobox", { name: "Message composer" });
      const card = editor.closest(".rounded-xl");
      const cardClass = card?.className;
      for (const [record, effort, speed, context] of [
        [second, "high", "Fast", "20.0% used, 20K tokens"],
        [entry, "low", "Standard", "10.0% used, 10K tokens"],
      ] as const) {
        view.rerender(chat(record, 1));
        expect(view.getByRole("combobox", { name: "Message composer" })).toBe(editor);
        expect(editor.getAttribute("aria-disabled")).toBe("false");
        expect(editor.getAttribute("contenteditable")).toBe("true");
        expect(card?.className).toBe(cardClass);
        expect(view.queryByText("Preparing the session...") === null).toBe(true);
        for (const name of [
          `Select model, ${descriptor.label}, ${record.selectedModel!.modelId}`,
          effort,
          `Session context: ${context}`,
          ...(descriptor.kind === "opencode" ? [] : [`Speed: ${speed}`]),
        ]) {
          expect(view.getByRole("button", { name }).hasAttribute("disabled")).toBe(false);
        }
        typeIntoComposer(view.container, `Draft for ${record.id}`);
        expect(view.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
          true,
        );
      }
      expect(start).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
    }
  },
);

test.each(["model", "effort", "profile"] as const)(
  "keeps the workspace draft editor active and gates supported Resume controls while saving %s",
  async (control) => {
    const descriptor =
      control === "profile" ? OPENCODE_RUNTIME_DESCRIPTOR : CLAUDE_RUNTIME_DESCRIPTOR;
    const modelIds: readonly [string, string] =
      descriptor.kind === "claude" ? ["sonnet", "opus"] : ["gpt-5", "gpt-6"];
    const [initialModel, nextModel] = modelIds;
    const providerId = descriptor.kind === "claude" ? "anthropic" : "openai";
    const modelTrigger = `Select model, ${descriptor.label}, ${initialModel}`;
    const { Harness, workspace, entry, session, operations, definitions } =
      createPresentationScenario(descriptor.kind, [
        buildMessage("user", "Continue the interrupted turn", { id: "interrupted-user" }),
      ]);
    definitions.runtimeDefinitions = [descriptor];
    definitions.availableRuntimeDefinitions = [descriptor];
    entry.selectedModel = {
      runtimeKind: descriptor.kind,
      providerId,
      modelId: initialModel,
      variant: "low",
    };
    if (control === "profile") entry.selectedModel.profileId = "build";
    definitions.loadRepoRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: {
          models: modelIds.map((modelId) => ({
            id: `${providerId}/${modelId}`,
            providerId,
            providerName: descriptor.kind === "claude" ? "Anthropic" : "OpenAI",
            modelId,
            modelName: modelId,
            variants: ["low", "high"],
          })),
          profiles:
            control === "profile"
              ? [
                  { name: "build", mode: "primary" },
                  { name: "review", mode: "primary" },
                ]
              : [],
          defaultModelsByProvider: {},
        },
      },
    });
    const save = Promise.withResolvers<void>();
    let updateRecord = (_record: WorkspaceSession): void => {};
    const updateModel = mock<AgentOperationsContextValue["updateAgentSessionModel"]>(
      async (_identity, selection) => {
        await save.promise;
        updateRecord({
          ...entry,
          selectedModel: selection ? { ...selection, runtimeKind: entry.runtimeKind } : null,
        });
      },
    );
    operations.updateAgentSessionModel = updateModel;
    const resumeTurn = mock<AgentOperationsContextValue["continueInterruptedTurn"]>(async () => {});
    operations.continueInterruptedTurn = resumeTurn;
    function Chat() {
      const [record, setRecord] = useState(entry);
      updateRecord = setRecord;
      return (
        <WorkspaceSessionChat
          isActive
          workspace={workspace}
          record={record}
          chatSettings={DEFAULT_CHAT_SETTINGS}
          reusablePrompts={[]}
          onToolRefresh={() => {}}
          isMounted={() => true}
        />
      );
    }
    const view = render(
      <Harness>
        <Chat />
      </Harness>,
    );
    try {
      await waitFor(() => expect(view.getByLabelText("Pending queries").textContent).toBe("0"));
      await view.findByRole("button", { name: "Send message" });
      const editor = view.getByRole("combobox", { name: "Message composer" });
      const resume = view.queryByRole("button", { name: "Resume" });
      if (control === "profile") expect(resume).toBeNull();
      else {
        expect(resume).not.toBeNull();
        expect(resume?.hasAttribute("disabled")).toBe(false);
      }
      typeIntoComposer(view.container, "Unsent draft");
      const card = editor.closest(".rounded-xl");
      expect(card).not.toBeNull();
      const cardClass = card?.className;
      const triggerName = {
        model: modelTrigger,
        effort: "low",
        profile: "build",
      }[control];
      await act(async () => fireEvent.click(view.getByRole("button", { name: triggerName })));
      const option =
        control === "model"
          ? await view.findByRole("button", { name: `Select ${nextModel} model` })
          : await view.findByRole("option", { name: control === "effort" ? "high" : "review" });
      await act(async () => fireEvent.click(option));
      expect(updateModel).toHaveBeenCalledTimes(1);
      expect(updateModel.mock.calls[0]?.[0]).toMatchObject({
        runtimeKind: session.runtimeKind,
        externalSessionId: session.externalSessionId,
        workingDirectory: session.workingDirectory,
      });
      expect(editor.getAttribute("contenteditable")).toBe("true");
      expect(editor.getAttribute("aria-disabled")).toBe("false");
      expect(card?.className).toBe(cardClass);
      expect(view.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
        true,
      );
      if (resume) {
        expect(resume.isConnected).toBe(true);
        expect(resume.hasAttribute("disabled")).toBe(true);
        await act(async () => fireEvent.click(resume));
      }
      expect(resumeTurn).not.toHaveBeenCalled();
      expect(
        view.queryByText("Wait for the current send or session change before resuming."),
      ).toBeNull();
      expect(view.getByRole("button", { name: modelTrigger }).getAttribute("aria-disabled")).toBe(
        "true",
      );
      typeIntoComposer(view.container, "Unsent draft edited while saving");
      await act(async () => save.resolve());
      expect(editor.isConnected).toBe(true);
      expect(editor.textContent).toContain("Unsent draft edited while saving");
      expect(card?.className).toBe(cardClass);
      if (resume) {
        expect(resume.isConnected).toBe(true);
        expect(resume.hasAttribute("disabled")).toBe(false);
      }
      expect(view.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
        false,
      );
      expect(
        view.getByRole("button", {
          name: {
            model: `Select model, ${descriptor.label}, ${nextModel}`,
            effort: "high",
            profile: "review",
          }[control],
        }),
      ).toBeTruthy();
      if (resume) {
        await act(async () => fireEvent.click(resume));
        expect(resumeTurn).toHaveBeenCalledTimes(1);
        expect(resumeTurn).toHaveBeenCalledWith({
          runtimeKind: session.runtimeKind,
          externalSessionId: session.externalSessionId,
          workingDirectory: session.workingDirectory,
        });
      } else expect(view.queryByRole("button", { name: "Resume" })).toBeNull();
    } finally {
      save.resolve();
      view.unmount();
    }
  },
);

test.each(["light", "dark"] as const)(
  "workspace child attention follows live input and full identity in the %s theme",
  async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const { Harness, store, session } = createPresentationScenario("opencode", [
      buildMessage("assistant", "Inspect the code", {
        id: "subagent-message",
        meta: {
          kind: "subagent",
          partId: "child-part",
          correlationKey: "child-part",
          externalSessionId: "native-child",
          agent: "Explorer",
          status: "running",
        },
      }),
    ]);
    const child = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "native-child",
      workingDirectory: "/repo",
      sessionAssociation: { kind: "repository" },
      liveParentExternalSessionId: "native-parent",
      status: "running",
      pendingApprovals: [],
      pendingQuestions: [],
    });
    store.replaceSession(child);
    const view = render(<Harness />);
    try {
      await view.findByText("Running");
      const badgeRow = view.getByText("Explorer").parentElement!;
      expect(badgeRow.querySelector(".animate-spin")).not.toBeNull();
      await act(async () => {
        store.replaceSession({ ...child, pendingApprovals: [buildApprovalRequest()] });
      });
      expect(view.getByText("Waiting for input")).toBeTruthy();
      expect(badgeRow.querySelector(".animate-spin")).toBeNull();
      await act(async () => {
        store.replaceSession({ ...child, pendingQuestions: [buildQuestionRequest()] });
      });
      expect(view.getByText("Waiting for input")).toBeTruthy();
      expect(badgeRow.querySelector(".animate-spin")).toBeNull();
      await act(async () => {
        store.replaceSession(child);
        store.replaceSession({
          ...child,
          runtimeKind: "claude",
          pendingApprovals: [buildApprovalRequest()],
        });
        store.replaceSession({
          ...child,
          workingDirectory: "/other",
          pendingQuestions: [buildQuestionRequest()],
        });
      });
      expect(view.getByText("Running")).toBeTruthy();
      expect(view.queryByText("Waiting for input")).toBeNull();
      expect(badgeRow.querySelector(".animate-spin")).not.toBeNull();
      await act(async () => {
        store.replaceSession({
          ...session,
          pendingQuestions: [
            buildQuestionRequest({
              source: {
                kind: "subagent",
                parentExternalSessionId: "native-parent",
                childExternalSessionId: "native-child",
                subagentCorrelationKey: "subagent-message",
              },
            }),
          ],
        });
      });
      expect(view.getByText("Waiting for input")).toBeTruthy();
      expect(badgeRow.querySelector(".animate-spin")).toBeNull();
    } finally {
      view.unmount();
      document.documentElement.classList.remove("dark");
    }
  },
  // The full chat render waits for catalog, history, and runtime reads.
  5000,
);

test.each(["light", "dark"] as const)(
  "workspace Claude history renders skill chips and the runtime todo accent in the %s theme",
  async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const skill = { id: "review", name: "review", path: "review", title: "Review code" };
    const { Harness, definitions, operations } = createPresentationScenario("claude", [
      buildMessage("user", "/review", { id: "plain", meta: { kind: "user", state: "read" } }),
      buildMessage("user", "/review", {
        id: "structured",
        meta: {
          kind: "user",
          state: "read",
          parts: [
            {
              kind: "skill_mention",
              skill,
              sourceText: { value: "/review", start: 0, end: 7 },
            },
          ],
        },
      }),
    ]);
    definitions.runtimeDefinitions = [CLAUDE_RUNTIME_DESCRIPTOR];
    definitions.availableRuntimeDefinitions = [CLAUDE_RUNTIME_DESCRIPTOR];
    definitions.loadRepoRuntimeCatalog = async () => ({
      models: { status: "available", catalog: { models: [], defaultModelsByProvider: {} } },
      skills: { status: "available", catalog: { skills: [skill] } },
    });
    operations.readSessionTodos = async () => [
      { id: "todo-1", content: "Review the code", status: "pending", priority: "medium" },
    ];
    const view = render(<Harness />);
    try {
      await view.findByLabelText("Agent todo list");
      await waitFor(() => expect(view.getAllByTitle("Review code").length).toBe(2));
      const accent = view.getByLabelText("Agent todo list").firstElementChild;
      if (!(accent instanceof HTMLElement)) throw new Error("Expected the todo accent element");
      expect(accent.style.borderLeftColor).toBe("var(--odt-runtime-accent-claude)");
    } finally {
      view.unmount();
      document.documentElement.classList.remove("dark");
    }
  },
  // The full chat render waits for catalog, history, and runtime reads.
  5000,
);

test("workspace Recheck disables repeat input and shows pending feedback", async () => {
  const { Harness, workspace, entry, store, session } = createPresentationScenario();
  store.replaceSession({ ...session, historyLoadState: "not_requested" });
  let finishRefresh = () => {};
  let refreshCount = 0;
  function BlockedChat() {
    const [isRefreshing, setRefreshing] = useState(false);
    const status = createHostRuntimeStatusContextValue({
      readError: "Runtime check failed",
      isRefreshing,
      refresh: async () => {
        refreshCount += 1;
        setRefreshing(true);
        await new Promise<void>((resolve) => {
          finishRefresh = resolve;
        });
        setRefreshing(false);
      },
    });
    return (
      <HostRuntimeStatusContext value={status}>
        <WorkspaceSessionChat
          isActive
          workspace={workspace}
          record={entry}
          chatSettings={DEFAULT_CHAT_SETTINGS}
          reusablePrompts={[]}
          onToolRefresh={() => {}}
          isMounted={() => true}
        />
      </HostRuntimeStatusContext>
    );
  }
  const view = render(
    <Harness>
      <BlockedChat />
    </Harness>,
  );
  try {
    const recheck = await view.findByRole("button", { name: "Recheck" });
    if (!(recheck instanceof HTMLButtonElement)) throw new Error("Expected the Recheck button");
    await act(async () => {
      fireEvent.click(recheck);
    });
    expect(recheck.disabled).toBe(true);
    expect(recheck.querySelector(".animate-spin")).not.toBeNull();
    await act(async () => {
      fireEvent.click(recheck);
    });
    expect(refreshCount).toBe(1);
    await act(async () => {
      finishRefresh();
    });
    expect(recheck.disabled).toBe(false);
    expect(recheck.querySelector(".animate-spin")).toBeNull();
  } finally {
    finishRefresh();
    view.unmount();
  }
  // The full chat render waits for the deferred runtime check and catalog reads.
}, 5000);

test("a missing workspace session retries observation, keeps failure visible, and restores its own transcript", async () => {
  const workspace = { workspaceId: "A", workspaceName: "Test", repoPath: "/repo" };
  const entry: WorkspaceSession = {
    id: "missing-session",
    runtimeKind: "opencode",
    externalSessionId: "missing-native",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    targetBranch: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
  const session = createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "missing-native",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "repository" },
    historyLoadState: "loaded",
    status: "idle",
    messages: [buildMessage("user", "Intended conversation", { id: "intended" })],
  });
  const unrelated = createAgentSessionFixture({
    externalSessionId: "unrelated-native",
    workingDirectory: "/repo",
    historyLoadState: "loaded",
    messages: [buildMessage("user", "Unrelated conversation", { id: "unrelated" })],
  });
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(unrelated);
  const h = createWorkspaceChatHarness({
    workspace,
    entry,
    session,
    store,
    scenario: "observation-failure",
    counters: { runtimeReads: 0, baselineLoads: 0, revalidations: 0 },
  });
  const history = spyOn(h.operations, "loadAgentSessionHistory");
  const view = render(<h.Harness />);
  try {
    await view.findByText("Observation failed");
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(h.observationRetries()).toBe(1);
    expect(history).not.toHaveBeenCalled();
    await act(async () => h.failObservation());
    expect(view.getByText("Observation failed")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(h.observationRetries()).toBe(2);
    await act(async () => {
      store.replaceSession(session);
      h.completeObservation();
    });
    await view.findByText("Intended conversation");
    expect(view.queryByText("Unrelated conversation")).toBeNull();
    expect(store.getSessionSnapshot(unrelated)).toBe(unrelated);
  } finally {
    view.unmount();
    history.mockRestore();
  }
});

test("returning to a retained chat expands requests without clearing drafts, while a preview keeps collapse choices", async () => {
  const workspace = { workspaceId: "A", workspaceName: "Test", repoPath: "/repo" };
  const entry: WorkspaceSession = {
    id: "session-1",
    runtimeKind: "opencode",
    externalSessionId: "native-1",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    targetBranch: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
  const session = createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "native-1",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "repository" },
    historyLoadState: "loaded",
    livePresence: "present",
    status: "idle",
    pendingQuestions: [
      buildQuestionRequest({
        questions: [{ header: "Draft", question: "Enter an answer", options: [] }],
      }),
    ],
    pendingApprovals: [buildApprovalRequest()],
  });
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(session);
  const { Harness } = createWorkspaceChatHarness({
    workspace,
    entry,
    session,
    store,
    scenario: "switch-return",
    counters: { runtimeReads: 0, baselineLoads: 0, revalidations: 0 },
  });
  const other = { ...entry, id: "session-2", externalSessionId: null };
  const onToolRefresh = () => {};
  const onSelectFile = () => {};
  const content = (record: WorkspaceSession, preview = false) => (
    <Harness>
      <div style={{ visibility: preview ? "hidden" : undefined }} inert={preview}>
        {[entry, other].map((pane) => (
          <SessionViewContext
            key={pane.id}
            value={{ id: pane.id, isActive: pane.id === record.id }}
          >
            <WorkspaceSessionChatPane
              workspace={workspace}
              record={pane}
              isActive={pane.id === record.id}
              workingDirectory="/repo"
              branchKey="main"
              onToolRefresh={onToolRefresh}
              onSelectFile={onSelectFile}
            />
          </SessionViewContext>
        ))}
      </div>
    </Harness>
  );
  const view = render(content(entry));
  try {
    const textarea = await view.findByPlaceholderText("Write your answer...");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Expected an answer textarea");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Preserved visit draft" } });
      fireEvent.click(view.getByRole("button", { name: "Collapse question request" }));
      fireEvent.click(view.getByRole("button", { name: "Collapse permission request" }));
    });
    await act(async () => {
      view.rerender(content(entry, true));
    });
    await act(async () => {
      view.rerender(content(entry));
    });
    expect(view.getByRole("button", { name: "Expand question request" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Expand permission request" })).toBeTruthy();

    await act(async () => {
      view.rerender(content(other));
    });
    await act(async () => {
      view.rerender(content(entry));
    });
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Collapse question request" })).toBeTruthy(),
    );
    expect(view.getByRole("button", { name: "Collapse permission request" })).toBeTruthy();
    expect(view.getByPlaceholderText("Write your answer...")).toBe(textarea);
    expect(textarea.value).toBe("Preserved visit draft");
    expect(view.getByText("1/1 answered")).toBeTruthy();
  } finally {
    view.unmount();
  }
  // The full chat render includes settings queries and retained Activity transitions.
}, 5000);

test.each(["retry", "streaming", "record-failure"] as const)(
  "workspace chat %s preserves readiness and completed turns",
  async (scenario) => {
    const workspace = { workspaceId: "A", workspaceName: "Test", repoPath: "/repo" };
    const entry: WorkspaceSession = {
      id: "session-1",
      runtimeKind: "opencode",
      externalSessionId: "native-1",
      executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      targetBranch: null,
      createdAt: 1000,
      updatedAt: 1000,
      archivedAt: null,
    };
    const messages = [
      buildMessage("user", "First question", { id: "user-1" }),
      buildMessage("assistant", "Completed answer", { id: "assistant-1" }),
      buildMessage("user", "Second question", { id: "user-2" }),
      buildMessage("assistant", "Current answer", { id: "assistant-2" }),
    ];
    const session = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "native-1",
      workingDirectory: "/repo",
      sessionAssociation: { kind: "repository" },
      historyLoadState: "loaded",
      status: scenario === "streaming" ? "running" : "idle",
      messages,
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const store = createAgentSessionsStore("/repo");
    store.replaceSession(session);
    const counters: WorkspaceChatCounters = {
      runtimeReads: 0,
      baselineLoads: 0,
      revalidations: 0,
    };
    const { Harness, connection, completeObservation } = createWorkspaceChatHarness({
      workspace,
      entry,
      session,
      store,
      scenario,
      counters,
    });
    const renderCounts = new Map<string, number>();
    const OriginalMessageBody = messageContent.MessageBody;
    const body = spyOn(messageContent, "MessageBody").mockImplementation((props) => {
      renderCounts.set(props.message.id, (renderCounts.get(props.message.id) ?? 0) + 1);
      return <OriginalMessageBody {...props} />;
    });
    const buildPickerItems = spyOn(modelPickerModel, "buildModelPickerItems");
    const draftPersistence = createWorkspaceSessionChatDraftPersistence(
      connection.drafts.chat,
      workspace.workspaceId,
      entry.id,
    );
    const view = render(<Harness />);
    try {
      if (scenario === "streaming") {
        await view.findByText("Completed answer", {}, { timeout: 2000 });
        await view.findByText("Current answer", {}, { timeout: 2000 });
        await waitFor(() => expect(view.getByLabelText("Pending queries").textContent).toBe("0"), {
          timeout: 2000,
        });
        const completedRenders = renderCounts.get("assistant-1");
        const currentRenders = renderCounts.get("assistant-2") ?? 0;
        const catalogBuilds = buildPickerItems.mock.calls.length;
        expect(catalogBuilds).toBeGreaterThan(0);
        expect(completedRenders).toBeGreaterThan(0);
        await act(async () => {
          store.replaceSession({
            ...session,
            messages: createSessionMessagesState(
              "native-1",
              [
                ...session.messages.items.slice(0, 3),
                { ...session.messages.items[3]!, content: "Current answer with another token" },
              ],
              session.messages.version + 1,
            ),
          });
        });
        await view.findByText("Current answer with another token", {}, { timeout: 2000 });
        expect(renderCounts.get("assistant-2")).toBeGreaterThan(currentRenders);
        expect(renderCounts.get("assistant-1")).toBe(completedRenders);
        expect(buildPickerItems).toHaveBeenCalledTimes(catalogBuilds);
        const composer = view.getByLabelText("Message composer");
        await act(async () => {
          store.replaceSession({
            ...session,
            pendingQuestions: [
              { requestId: "background-question", blocking: false, questions: [] },
            ],
          });
        });
        expect(composer.getAttribute("contenteditable")).toBe("true");
        await act(async () => {
          store.replaceSession({
            ...session,
            pendingQuestions: [{ requestId: "blocking-question", questions: [] }],
          });
        });
        expect(composer.getAttribute("contenteditable")).toBe("false");
        expect(view.getByRole("button", { name: "Stop session" })).toBeTruthy();
        return;
      }
      const composer = view.getByLabelText("Message composer");
      expect(composer.getAttribute("contenteditable")).toBe("false");
      if (scenario === "record-failure") {
        await view.findByText("Chat records failed");
        expect(view.getByText("Completed answer")).toBeTruthy();
      } else {
        await act(async () => {
          fireEvent.click(view.getByRole("button", { name: "Retry" }));
        });
        expect(composer.getAttribute("contenteditable")).toBe("false");
        expect(view.queryByText("Workspace Session target mismatch")).toBeNull();
      }
      await act(async () => {
        completeObservation();
      });
      await waitFor(() => expect(composer.getAttribute("contenteditable")).toBe("true"), {
        timeout: 800,
      });
    } finally {
      view.unmount();
      await draftPersistence.flush();
      draftPersistence.clear();
      body.mockRestore();
      buildPickerItems.mockRestore();
    }
  },
  5000,
);

test("workspace chat reuses its loaded transcript when the view remounts", async () => {
  const workspace = { workspaceId: "A", workspaceName: "Test", repoPath: "/repo" };
  const entry: WorkspaceSession = {
    id: "session-1",
    runtimeKind: "opencode",
    externalSessionId: "native-1",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    targetBranch: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
  const session = createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "native-1",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "repository" },
    historyLoadState: "loaded",
    status: "idle",
    messages: [buildMessage("assistant", "Retained answer", { id: "assistant-1" })],
    pendingApprovals: [],
    pendingQuestions: [],
  });
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(session);
  const counters: WorkspaceChatCounters = {
    runtimeReads: 0,
    baselineLoads: 0,
    revalidations: 0,
  };
  const { Harness } = createWorkspaceChatHarness({
    workspace,
    entry,
    session,
    store,
    scenario: "switch-return",
    counters,
  });

  const view = render(<Harness />);
  try {
    await view.findByText("Retained answer", {}, { timeout: 2000 });
    expect(counters.revalidations).toBe(0);
    expect(counters.baselineLoads).toBe(0);

    await act(async () => {
      view.rerender(<Harness key="return" />);
    });

    await view.findByText("Retained answer", {}, { timeout: 2000 });
    expect(counters.baselineLoads).toBe(0);
    expect(counters.revalidations).toBe(0);
  } finally {
    view.unmount();
  }
}, 5000);

const savedModel: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  variant: "high",
  profileId: "build",
  speed: "priority",
};
const preparationCatalog = (): AgentModelCatalog => ({
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT 5",
      variants: ["low", "high"],
      speedLevels: [{ id: "priority", label: "Fast" }],
    },
  ],
  defaultModelsByProvider: { openai: "gpt-5" },
  profiles: [
    { name: "build", mode: "primary" },
    { name: "review", mode: "primary" },
  ],
});

function createPreparationScenario(
  selection: AgentModelSelection = savedModel,
  stageAttachment?: AttachmentStager,
) {
  const h = createPresentationScenario("opencode", [], stageAttachment);
  h.entry.selectedModel = { ...selection, runtimeKind: "opencode" };
  h.session.selectedModel = { ...selection };
  h.store.replaceSession(h.session);
  h.definitions.loadRepoRuntimeCatalog = async () => ({
    models: { status: "available", catalog: preparationCatalog() },
  });
  return h;
}

// Full chat renders and catalog reads need more than the suite's one-second timeout.
test("workspace Send waits for its first catalog with a saved model", async () => {
  const h = createPreparationScenario();
  const catalog =
    Promise.withResolvers<Awaited<ReturnType<typeof h.definitions.loadRepoRuntimeCatalog>>>();
  h.definitions.loadRepoRuntimeCatalog = () => catalog.promise;
  const send = mock(async () => null);
  h.operations.sendAgentMessage = send;
  const persistence = createWorkspaceSessionChatDraftPersistence(
    h.connection.drafts.chat,
    h.workspace.workspaceId,
    h.entry.id,
  );
  persistence.set({ segments: [createTextSegment("Wait for the catalog")] });
  const view = render(<h.Harness />);
  try {
    await view.findByLabelText("Message composer");
    expect(view.getByRole("button", { name: "Preparing message" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(send).not.toHaveBeenCalled();
    await act(async () =>
      catalog.resolve({ models: { status: "available", catalog: preparationCatalog() } }),
    );
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  } finally {
    catalog.resolve({ models: { status: "available", catalog: preparationCatalog() } });
    view.unmount();
  }
}, 5000);

test("workspace checks a new blocking question before submitting a staged attachment", async () => {
  const staging = Promise.withResolvers<{ path: string; mime: string }>();
  const stage = mock(() => staging.promise);
  const h = createPreparationScenario(
    { ...savedModel, variant: "removed" },
    createBrowserAttachmentStager({ workspaceStageLocalAttachment: stage }),
  );
  const update = mock(async () => {});
  const send = mock(async () => null);
  h.operations.updateAgentSessionModel = update;
  h.operations.sendAgentMessage = send;
  const catalog = preparationCatalog();
  catalog.models[0]!.attachmentSupport = { image: false, audio: false, video: false, pdf: true };
  const view = renderHook(
    () => {
      const actions = useWorkspaceSessionChatActions(h.workspace, h.entry, () => true);
      const _picker = useWorkspaceSessionModelPicker(h.workspace.repoPath, {
        identity: h.session,
        runtimeRef: {
          repoPath: h.workspace.repoPath,
          runtimeKind: h.session.runtimeKind,
          workingDirectory: h.session.workingDirectory,
        },
        updateDraft: actions.updateDraftModel,
        selection: h.session.selectedModel,
        catalog,
        isLoading: false,
        error: null,
        retry: async () => {},
        update: actions.updateSessionModel,
      });
      const assertCanSubmit = useAgentMessageSendPolicy();
      return useAgentChatSendForTarget(
        actions.sendTarget({
          canSend: true,
          assertCanSubmit,
        }),
        {
          identity: h.session,
          selectedModelDescriptor: catalog.models[0],
          draftRules: { reusablePrompts: [], supportsAttachments: true },
        },
      );
    },
    { wrapper: h.Harness },
  );
  let pending!: Promise<unknown>;
  try {
    await act(async () => {});
    act(() => {
      pending = view.result.current.onSend(
        {
          segments: [createTextSegment("Review the PDF")],
          attachments: [
            createComposerAttachment(
              {
                name: "brief.pdf",
                kind: "pdf",
                mime: "application/pdf",
                file: new File(["pdf"], "brief.pdf", { type: "application/pdf" }),
              },
              "brief",
            ),
          ],
        },
        "default",
      );
    });
    await waitFor(() => expect(stage).toHaveBeenCalledTimes(1));
    act(() => h.store.replaceSession({ ...h.session, pendingQuestions: [buildQuestionRequest()] }));
    await act(async () => {
      staging.resolve({ path: "/tmp/brief.pdf", mime: "application/pdf" });
      await pending;
    });
    expect(await pending).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

// These cases render retained panes with real catalog reads, preparation, and owner lifetime.
