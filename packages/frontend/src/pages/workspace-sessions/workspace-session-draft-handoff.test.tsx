import { expect, test } from "bun:test";
import {
  type AgentSessionControlSummary,
  CODEX_RUNTIME_DESCRIPTOR,
  type GitBranch,
  type WorkspaceSession,
  type WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import {
  ActiveWorkspaceContext,
  RuntimeDefinitionsContext,
  TaskSnapshotContext,
  TasksStateContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import type { StartupProgressListener } from "@openducktor/frontend-core/connection/host-connection";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import { createAgentMessageQueuesStore } from "@openducktor/frontend-core/sessions/agent-message-queues-store";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  AgentMessageQueuesContext,
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  HostRuntimeStatusContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { VisibleSessionTargetProvider } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostClient } from "@openducktor/host-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode, useLayoutEffect, useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { BrowserRuntimeProvider } from "@/features/browser/browser-runtime";
import { createRuntimeDefinitionsContextValue } from "@/pages/agents/agent-studio-test-utils";
import { SessionsPage } from "@/pages/sessions/sessions-page";
import {
  WorkspaceBranchStateContext,
  WorkspacePresenceContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { QueryProvider } from "@/test-utils/query-provider";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  createHostRuntimeStatusContextValue,
  createRepoSettingsConfigFixture,
  createRuntimeCatalogFixture,
  createSettingsSnapshotFixture,
  createTasksStateFixture,
  createWorkspacePresenceFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";

const WORKSPACE = createWorkspaceRecordFixture({
  workspaceId: "ws-1",
  workspaceName: "Demo Repo",
  repoPath: "/repo",
});

const BRANCHES: GitBranch[] = [
  { name: "main", isCurrent: true, isRemote: false },
  { name: "origin/main", isCurrent: false, isRemote: true },
];

const MODEL_CATALOG = createRuntimeCatalogFixture({
  models: {
    runtime: CODEX_RUNTIME_DESCRIPTOR,
    models: [
      {
        id: "openai/gpt-5",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5",
        modelName: "GPT-5",
        variants: ["high"],
      },
    ],
    defaultModelsByProvider: { openai: "gpt-5" },
    profiles: [],
  },
});

const makeSessionRecord = (
  id: string,
  overrides: Partial<WorkspaceSession> = {},
): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: null,
  executionTarget: { kind: "local_repo_root", workingDirectory: WORKSPACE.repoPath },
  roleSnapshot: null,
  selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
  generatedTitle: null,
  manualTitle: null,
  targetBranch: { remote: "origin", branch: "main" },
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
  ...overrides,
});

const makeRuntimeSession = (externalSessionId: string): AgentSessionControlSummary => ({
  externalSessionId,
  runtimeKind: "codex",
  workingDirectory: WORKSPACE.repoPath,
  startedAt: "2026-10-27T00:00:00.000Z",
  status: "idle",
});

function LocationProbe({
  onSearch,
  onNavigateReady,
}: {
  onSearch: (search: string) => void;
  onNavigateReady?: (navigate: ReturnType<typeof useNavigate>) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    onSearch(location.search);
    onNavigateReady?.(navigate);
  }, [location.search, navigate, onNavigateReady, onSearch]);
  return null;
}

type LaunchContext = { startupAttemptId: string; operationId: string; draftId: string };

function renderHandoffApp({
  initialRecords = [],
  initialEntry,
}: {
  initialRecords?: WorkspaceSession[];
  initialEntry?: (connection: ReturnType<typeof createTestClientConnection>) => string;
} = {}) {
  let progressListener: StartupProgressListener | null = null;
  let resolveLaunch!: (value: WorkspaceSessionLaunchResult) => void;
  let launchContext: LaunchContext | null = null;
  let nav!: ReturnType<typeof useNavigate>;

  const hostClient: Partial<HostClient> = {
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    workspaceGetRepoConfig: async () => ({
      ...createRepoSettingsConfigFixture(WORKSPACE.workspaceId, WORKSPACE.repoPath),
      workspaceName: WORKSPACE.workspaceName,
      defaultModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
      defaultTargetBranch: { remote: "origin", branch: "main" },
      branchPrefix: "odt",
      agentStudioState: { openTaskIds: [] },
    }),
    customAgentRoleList: async () => [],
    gitGetBranches: async () => BRANCHES,
    workspaceSessionWorktreesList: async () => ({ worktrees: [] }),
    workspaceSessionListActive: async () => initialRecords,
    agentRuntimeLoadCatalog: async () => MODEL_CATALOG,
    workspaceSessionLaunch: async (request) => {
      if (request.startup) {
        launchContext = { ...request.startup, draftId: request.draftId };
      }
      return new Promise<WorkspaceSessionLaunchResult>((resolve) => {
        resolveLaunch = resolve;
      });
    },
  };
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      client: hostClient,
      subscribeStartupProgress: async (listener) => {
        progressListener = listener;
        return () => {};
      },
    }),
  });
  connection.queryClient.setQueryData(
    workspaceSessionQueryKeys.list(WORKSPACE.workspaceId, false),
    initialRecords,
  );
  const live = createStartupLiveSourceFake(connection.queryClient);
  const sessions = createAgentSessionsStore(WORKSPACE.repoPath);
  const queues = createAgentMessageQueuesStore();
  const entry =
    initialEntry?.(connection) ??
    `/sessions?workspace=${WORKSPACE.workspaceId}&kind=workspace&draft=${connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE.workspaceId).id}`;
  const searches: string[] = [];

  function App() {
    const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace | null>(WORKSPACE);
    const tasksState = createTasksStateFixture();
    return (
      <StrictMode>
        <MemoryRouter initialEntries={[entry]}>
          <QueryProvider connection={connection}>
            <VisibleSessionTargetProvider>
              <ActiveWorkspaceContext value={{ activeWorkspace, setActiveWorkspace }}>
                <WorkspacePresenceContext
                  value={createWorkspacePresenceFixture({
                    hasWorkspaces: true,
                  })}
                >
                  <WorkspaceStateContext
                    value={createWorkspaceStateFixture({
                      activeWorkspace: WORKSPACE,
                      workspaces: [WORKSPACE],
                    })}
                  >
                    <TaskSnapshotContext value={tasksState}>
                      <TasksStateContext value={tasksState}>
                        <WorkspaceBranchStateContext
                          // SAFETY: test double stubs only the branch context fields read by SessionsPage.
                          value={
                            {
                              branches: BRANCHES,
                              activeBranch: BRANCHES[0] ?? null,
                              isSwitchingBranch: false,
                              isLoadingBranches: false,
                              branchesError: null,
                              refreshBranches: async () => {},
                              switchBranch: async () => {},
                            } as never
                          }
                        >
                          <RuntimeDefinitionsContext
                            value={createRuntimeDefinitionsContextValue({
                              runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
                              availableRuntimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
                              loadRepoRuntimeCatalog: async () => MODEL_CATALOG,
                            })}
                          >
                            <HostRuntimeStatusContext value={createHostRuntimeStatusContextValue()}>
                              <AgentSessionsContext value={sessions}>
                                <AgentMessageQueuesContext value={queues}>
                                  <AgentSessionHistoryLoadContext
                                    value={{ loadAgentSessionHistory: async () => null }}
                                  >
                                    <AgentSessionReadModelStateContext
                                      value={{
                                        sessionReadModelLoadState: {
                                          kind: "ready",
                                          workspaceRepoPath: WORKSPACE.repoPath,
                                        },
                                        workspaceSessionRecordsError: null,
                                        getSessionFault: () => null,
                                        reloadSessionReadModel: () => {},
                                      }}
                                    >
                                      <AgentOperationsContext
                                        // SAFETY: test double only stubs methods referenced by chat surface.
                                        value={
                                          {
                                            sendAgentMessage: async () => null,
                                            stopAgentSession: async () => {},
                                            replyAgentApproval: async () => {},
                                            answerAgentQuestion: async () => {},
                                            readSessionTodos: async () => [],
                                            loadAgentSessionHistory: async () => {},
                                            loadAgentSessionContext: async () => {},
                                            updateAgentSessionModel: async () => {},
                                            continueInterruptedTurn: async () => {},
                                            cancelUsageLimitAutoResume: async () => {},
                                          } as never
                                        }
                                      >
                                        <ThemeProvider>
                                          <SettingsModalProvider>
                                            <BrowserRuntimeProvider>
                                              <WorkspacePreviewTransitionGuardProvider>
                                                <LocationProbe
                                                  onSearch={(search) => searches.push(search)}
                                                  onNavigateReady={(fn) => {
                                                    nav = fn;
                                                  }}
                                                />
                                                <SessionsPage />
                                              </WorkspacePreviewTransitionGuardProvider>
                                            </BrowserRuntimeProvider>
                                          </SettingsModalProvider>
                                        </ThemeProvider>
                                      </AgentOperationsContext>
                                    </AgentSessionReadModelStateContext>
                                  </AgentSessionHistoryLoadContext>
                                </AgentMessageQueuesContext>
                              </AgentSessionsContext>
                            </HostRuntimeStatusContext>
                          </RuntimeDefinitionsContext>
                        </WorkspaceBranchStateContext>
                      </TasksStateContext>
                    </TaskSnapshotContext>
                  </WorkspaceStateContext>
                </WorkspacePresenceContext>
              </ActiveWorkspaceContext>
            </VisibleSessionTargetProvider>
          </QueryProvider>
        </MemoryRouter>
      </StrictMode>
    );
  }

  const view = render(<App />);

  const getLaunchContext = (): LaunchContext => {
    if (!launchContext) throw new Error("Expected launchContext to be recorded");
    return launchContext;
  };

  const emitSavedProgress = async ({
    unboundRecord,
    boundRecord,
    runtimeSession,
  }: {
    unboundRecord: WorkspaceSession;
    boundRecord: WorkspaceSession;
    runtimeSession: AgentSessionControlSummary;
  }) => {
    const context = getLaunchContext();
    const preparedSnapshot = live.prepared({
      context: {
        startupAttemptId: context.startupAttemptId,
        operationId: context.operationId,
      },
      workspaceId: WORKSPACE.workspaceId,
      repoPath: WORKSPACE.repoPath,
      scope: {
        kind: "workspace",
        sessionId: boundRecord.id,
        draftId: context.draftId,
      },
      ownership: {
        state: "saved",
        target: { kind: "workspace", record: boundRecord, runtimeSession },
      },
    });
    await act(async () => {
      progressListener?.({
        channel: "openducktor://session-startup-progress",
        payload: {
          context: {
            startupAttemptId: context.startupAttemptId,
            operationId: context.operationId,
          },
          hostInstanceId: preparedSnapshot.hostInstanceId,
          revision: 1,
          workspaceId: WORKSPACE.workspaceId,
          repoPath: WORKSPACE.repoPath,
          scope: {
            kind: "workspace",
            sessionId: unboundRecord.id,
            draftId: context.draftId,
          },
          phase: "running",
          ownership: {
            state: "saved",
            target: { kind: "workspace", record: unboundRecord },
          },
          steps: [
            { id: "checkout", label: "Use current checkout", state: "completed", details: [] },
            { id: "prepare", label: "Start session", state: "running", details: [] },
            {
              id: "instruction",
              label: "Submit initial instruction",
              state: "pending",
              details: [],
            },
          ],
        },
      });
    });
    return preparedSnapshot;
  };

  const completeLaunch = async ({
    boundRecord,
    runtimeSession,
    preparedSnapshot,
    submissionId,
  }: {
    boundRecord: WorkspaceSession;
    runtimeSession: AgentSessionControlSummary;
    preparedSnapshot: ReturnType<typeof live.prepared>;
    submissionId: string;
  }) => {
    await act(async () => {
      resolveLaunch({
        workspaceId: WORKSPACE.workspaceId,
        repoPath: WORKSPACE.repoPath,
        status: "completed",
        sessionId: boundRecord.id,
        record: boundRecord,
        session: runtimeSession,
        startupProgress: {
          ...preparedSnapshot,
          revision: 2,
          instruction: { state: "accepted", submissionId },
          steps: [
            { id: "checkout", label: "Use current checkout", state: "completed", details: [] },
            { id: "prepare", label: "Start session", state: "completed", details: [] },
            {
              id: "instruction",
              label: "Submit initial instruction",
              state: "completed",
              details: [],
            },
          ],
        },
      });
    });
  };

  return {
    view,
    connection,
    searches,
    navigate: (to: string) => nav(to),
    waitForLaunch: async () => {
      await waitFor(() => expect(launchContext).not.toBeNull());
      return getLaunchContext();
    },
    emitSavedProgress,
    completeLaunch,
    dispose: async () => {
      view.unmount();
      live.dispose();
      await connection.dispose();
    },
  };
}

test("StrictMode SSE saved handoff transitions in place to the saved session without creating a replacement draft or backgrounding startup", async () => {
  const unboundRecord = makeSessionRecord("saved-session-1", { generatedTitle: "Hello world" });
  const boundRecord: WorkspaceSession = { ...unboundRecord, externalSessionId: "native-1" };
  const runtimeSession = makeRuntimeSession("native-1");
  const app = renderHandoffApp();
  try {
    const editor = app.view.container.querySelector("[data-composer-editor]");
    if (!(editor instanceof HTMLElement)) throw new Error("Expected composer editor");
    await waitFor(() => expect(editor.getAttribute("contenteditable")).toBe("true"));
    await act(async () => {
      editor.textContent = "Hello world";
      fireEvent.input(editor);
    });
    const sendButton = await app.view.findByRole("button", { name: "Send message" });
    await waitFor(() => expect(sendButton.hasAttribute("disabled")).toBe(false));
    await act(async () => {
      fireEvent.click(sendButton);
    });
    const launchContext = await app.waitForLaunch();

    // Emit SSE saved ownership while runtime start is still running.
    const preparedSnapshot = await app.emitSavedProgress({
      unboundRecord,
      boundRecord,
      runtimeSession,
    });

    await waitFor(() => {
      expect(app.searches.at(-1)).toContain(`session=${unboundRecord.id}`);
    });
    expect(app.searches.at(-1)).not.toContain("draft=");
    expect(app.connection.drafts.newWorkspaceSessions.getSnapshot()).toHaveLength(0);
    expect(
      app.connection.startupAttempts.getAttempt(launchContext.startupAttemptId)?.presentation,
    ).toBe("inline");
    // While startup is still running after host save, keep composer locked in starting state
    // and avoid re-animating the submitted message bubble or startup card.
    const handoffEditor = app.view.container.querySelector("[data-composer-editor]");
    expect(handoffEditor?.getAttribute("contenteditable")).toBe("false");
    expect(app.view.getByText("Sending…")).toBeDefined();

    // Finish launch and verify Session ready summary row remains inline (not released by StrictMode).
    await app.completeLaunch({
      boundRecord,
      runtimeSession,
      preparedSnapshot,
      submissionId: "sub-1",
    });

    await waitFor(() => {
      const attempt = app.connection.startupAttempts.getAttempt(launchContext.startupAttemptId);
      expect(attempt?.status.phase).toBe("ready");
      expect(attempt?.presentation).toBe("inline");
    });
    expect(app.view.getByText("Session ready")).toBeDefined();
  } finally {
    await app.dispose();
  }
}, 5_000);

test("StrictMode opening a new draft from an existing session and submitting hands off without replacement draft or toast", async () => {
  const existingRecord = makeSessionRecord("existing-session-1", {
    externalSessionId: "native-existing",
    generatedTitle: "Existing session",
    createdAt: 500,
    updatedAt: 500,
  });
  const unboundRecord = makeSessionRecord("saved-session-2");
  const boundRecord: WorkspaceSession = {
    ...unboundRecord,
    externalSessionId: "native-2",
    generatedTitle: "From existing",
  };
  const runtimeSession = makeRuntimeSession("native-2");

  const app = renderHandoffApp({
    initialRecords: [existingRecord],
    initialEntry: () =>
      `/sessions?workspace=${WORKSPACE.workspaceId}&kind=workspace&session=${existingRecord.id}`,
  });
  let sawUnavailableFlash = false;
  let sawUntitledFlash = false;
  const flashObserver = new MutationObserver(() => {
    const text = app.view.container.textContent ?? "";
    if (text.includes("This session is unavailable")) sawUnavailableFlash = true;
    if (text.includes("Untitled session")) sawUntitledFlash = true;
  });
  flashObserver.observe(app.view.container, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  try {
    await waitFor(() => expect(app.view.getByText("Existing session")).toBeDefined());
    const draft = app.connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE.workspaceId);
    await act(async () => {
      void app.navigate(
        `/sessions?workspace=${WORKSPACE.workspaceId}&kind=workspace&draft=${draft.id}`,
      );
    });
    const editor = await waitFor(() => {
      const nodes = [...app.view.container.querySelectorAll("[data-composer-editor]")];
      const node = nodes.find(
        (candidate): candidate is HTMLElement =>
          candidate instanceof HTMLElement && candidate.closest("[inert]") === null,
      );
      if (!node) throw new Error("Missing active draft editor");
      expect(node.getAttribute("contenteditable")).toBe("true");
      return node;
    });
    const draftSearches = app.searches.filter((search) => search.includes("draft="));
    expect(draftSearches.length).toBeGreaterThan(0);
    expect(draftSearches.every((search) => search.includes(`draft=${draft.id}`))).toBe(true);
    await act(async () => {
      editor.textContent = "From existing";
      fireEvent.input(editor);
    });
    const sendButton = await waitFor(() => {
      const buttons = app.view.getAllByRole("button", { name: "Send message" });
      const activeButton = buttons.find((button) => button.closest("[inert]") === null);
      if (!activeButton) throw new Error("Missing active send button");
      expect(activeButton.hasAttribute("disabled")).toBe(false);
      return activeButton;
    });
    await act(async () => {
      fireEvent.click(sendButton);
    });
    const launchContext = await app.waitForLaunch();

    const preparedSnapshot = await app.emitSavedProgress({
      unboundRecord,
      boundRecord,
      runtimeSession,
    });

    await waitFor(() => {
      expect(app.searches.at(-1)).toContain(`session=${unboundRecord.id}`);
    });
    expect(app.searches.at(-1)).not.toContain("draft=");
    expect(app.connection.drafts.newWorkspaceSessions.getSnapshot()).toHaveLength(0);
    expect(
      app.connection.startupAttempts.getAttempt(launchContext.startupAttemptId)?.presentation,
    ).toBe("inline");
    const handoffToggle = app.view.getByRole("button", { name: /^Starting session\./ });
    expect(handoffToggle.getAttribute("aria-expanded")).toBe("true");
    expect(handoffToggle.closest(".inline-startup-enter")).toBeNull();
    expect(app.view.getByRole("list", { name: "Session startup steps" })).toBeDefined();
    expect(sawUnavailableFlash).toBe(false);
    expect(sawUntitledFlash).toBe(false);

    await app.completeLaunch({
      boundRecord,
      runtimeSession,
      preparedSnapshot,
      submissionId: "sub-2",
    });

    await waitFor(() => {
      const attempt = app.connection.startupAttempts.getAttempt(launchContext.startupAttemptId);
      expect(attempt?.status.phase).toBe("ready");
      expect(attempt?.presentation).toBe("inline");
    });
    expect(app.view.getByText("Session ready")).toBeDefined();
    expect(sawUnavailableFlash).toBe(false);
    expect(sawUntitledFlash).toBe(false);
  } finally {
    flashObserver.disconnect();
    await app.dispose();
  }
}, 5_000);
