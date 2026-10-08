import { expect, spyOn, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_CHAT_SETTINGS,
  CLAUDE_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { act, type ReactElement, type ReactNode, useState } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { useIsFetching } from "@tanstack/react-query";
import * as messageContent from "@/components/features/agents/agent-chat/agent-chat-message-card-content";
import { buildMessage } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import * as modelPickerModel from "@/components/features/agents/model-picker/model-picker-model";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import {
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  HostRuntimeStatusContext,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@/state/app-state-contexts";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
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
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { WorkspaceSessionChat } from "./workspace-session-chat";
import { WorkspaceSessionChatPanes } from "./workspace-session-chat-panes";
import {
  buildApprovalRequest,
  buildQuestionRequest,
} from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import { createWorkspaceSessionChatDraftPersistence } from "./workspace-session-chat-draft";
import { createTextSegment } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";

function QueryStatus() {
  const pending = useIsFetching();
  return (
    <output aria-label="Pending queries" hidden>
      {pending}
    </output>
  );
}

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
}: {
  workspace: ActiveWorkspace;
  entry: WorkspaceSession;
  session: AgentSessionState;
  store: ReturnType<typeof createAgentSessionsStore>;
  scenario: WorkspaceChatScenario;
  counters: WorkspaceChatCounters;
}) => {
  const operations: AgentOperationsContextValue = {
    describeGeneratedImages: async () => {
      throw new Error("Unexpected image metadata read");
    },
    beginGeneratedImageBatch: async () => {
      throw new Error("Unexpected image batch");
    },
    releaseGeneratedImageBatch: async () => {
      throw new Error("Unexpected image batch release");
    },
    readGeneratedImage: async () => {
      throw new Error("Unexpected image read");
    },
    readSessionTodos: async () => {
      counters.runtimeReads += 1;
      return [];
    },
    readSessionHistory: async () => [],
    loadAgentSessionHistory: async () => {
      counters.runtimeReads += 1;
      return session;
    },
    loadAgentSessionContext: async () => {
      counters.runtimeReads += 1;
    },
    startAgentSession: async () => {
      throw new Error("Unexpected session startup");
    },
    sendAgentMessage: async () => {
      throw new Error("Unexpected message send");
    },
    stopAgentSession: async () => {},
    continueInterruptedTurn: async () => undefined,
    updateAgentSessionModel: async () => {},
    replyAgentApproval: async () => {},
    answerAgentQuestion: async () => {},
  };
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
      <QueryProvider useIsolatedClient>
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
                    {children ?? (
                      <WorkspaceSessionChat
                        workspace={workspace}
                        record={entry}
                        chatSettings={DEFAULT_CHAT_SETTINGS}
                        reusablePrompts={[]}
                        onToolRefresh={() => {}}
                        isMounted={() => true}
                      />
                    )}
                  </AgentSessionsContext>
                </AgentSessionReadModelStateContext>
              </AgentSessionHistoryLoadContext>
            </AgentOperationsContext>
          </HostRuntimeStatusContext>
        </RuntimeDefinitionsContext>
      </QueryProvider>
    );
  }

  return {
    Harness,
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
    }),
  };
};

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
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
      }),
    );
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
      configureShellBridge(createUnavailableShellBridge());
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
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
      }),
    );
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
      configureShellBridge(createUnavailableShellBridge());
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
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );
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
    configureShellBridge(createUnavailableShellBridge());
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
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );
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
    configureShellBridge(createUnavailableShellBridge());
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
        <WorkspaceSessionChatPanes
          workspace={workspace}
          record={record}
          sessionIds={[entry.id, other.id]}
          workingDirectory="/repo"
          branchKey="main"
          onToolRefresh={onToolRefresh}
          onSelectFile={onSelectFile}
        />
      </div>
    </Harness>
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
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
    configureShellBridge(createUnavailableShellBridge());
  }
  // The full chat render includes settings queries and retained Activity transitions.
}, 5000);

test.each(["retry", "streaming", "draft", "record-failure"] as const)(
  "workspace chat %s preserves readiness and completed turns",
  async (scenario) => {
    const workspace = { workspaceId: "A", workspaceName: "Test", repoPath: "/repo" };
    const entry: WorkspaceSession = {
      id: "session-1",
      runtimeKind: "opencode",
      externalSessionId: scenario === "draft" ? null : "native-1",
      executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
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
    if (scenario !== "draft") store.replaceSession(session);
    const counters: WorkspaceChatCounters = {
      runtimeReads: 0,
      baselineLoads: 0,
      revalidations: 0,
    };
    const { Harness, completeObservation } = createWorkspaceChatHarness({
      workspace,
      entry,
      session,
      store,
      scenario,
      counters,
    });
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
      }),
    );
    const renderCounts = new Map<string, number>();
    const OriginalMessageBody = messageContent.MessageBody;
    const body = spyOn(messageContent, "MessageBody").mockImplementation((props) => {
      renderCounts.set(props.message.id, (renderCounts.get(props.message.id) ?? 0) + 1);
      return <OriginalMessageBody {...props} />;
    });
    const buildPickerItems = spyOn(modelPickerModel, "buildModelPickerItems");
    const draftPersistence = createWorkspaceSessionChatDraftPersistence(
      workspace.workspaceId,
      entry.id,
    );
    if (scenario === "draft") {
      draftPersistence.set({ segments: [createTextSegment("Unsent draft survives reload")] });
      await draftPersistence.flush();
    }
    const view = render(<Harness />);
    try {
      if (scenario === "draft") {
        await waitFor(() => expect(view.getByLabelText("Pending queries").textContent).toBe("0"), {
          timeout: 2000,
        });
        expect(view.getByLabelText("Message composer").textContent).toContain(
          "Unsent draft survives reload",
        );
        expect(view.getByLabelText("Message composer").getAttribute("contenteditable")).toBe(
          "true",
        );
        expect(view.queryByText("Loading session")).toBeNull();
        expect(counters.runtimeReads).toBe(0);
        return;
      }
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
      configureShellBridge(createUnavailableShellBridge());
    }
  },
  5000,
);

test("workspace chat keeps a retained transcript when the workspace switches away and back", async () => {
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
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );

  const view = render(<Harness />);
  try {
    await view.findByText("Retained answer", {}, { timeout: 2000 });
    expect(counters.revalidations).toBe(0);
    expect(counters.baselineLoads).toBe(0);

    await act(async () => {
      store.resetWorkspace("/other");
      store.resetWorkspace("/repo");
      view.rerender(<Harness key="return" />);
    });

    await view.findByText("Retained answer", {}, { timeout: 2000 });
    expect(counters.baselineLoads).toBe(0);
    await waitFor(() => expect(counters.revalidations).toBe(1));
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5000);
