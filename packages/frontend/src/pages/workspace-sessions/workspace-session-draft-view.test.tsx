import { expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  type GitBranch,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type WorkspaceSession,
  type WorkspaceSessionLaunchRequest,
  type WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import {
  ActiveWorkspaceContext,
  RuntimeDefinitionsContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useNewWorkspaceSessionDraft } from "@openducktor/frontend-core/drafts/use-new-workspace-session-drafts";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  HostRuntimeStatusContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import type { HostClient } from "@openducktor/host-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { createRuntimeDefinitionsContextValue } from "@/pages/agents/agent-studio-test-utils";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createHostRuntimeStatusContextValue,
  createRepoSettingsConfigFixture,
  createRuntimeCatalogFixture,
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { WorkspaceSessionDraftView } from "./workspace-session-draft-view";

const WORKSPACE = createWorkspaceRecordFixture({
  workspaceId: "ws-1",
  workspaceName: "Demo Repo",
  repoPath: "/repo",
});

const SECOND_WORKSPACE = createWorkspaceRecordFixture({
  workspaceId: "ws-2",
  workspaceName: "Other Repo",
  repoPath: "/other-repo",
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

function setup(
  overrides: Partial<HostClient> = {},
  options: { workspaces?: (typeof WORKSPACE)[] } = {},
) {
  const workspaces = options.workspaces ?? [WORKSPACE];
  const switchedTo: string[] = [];
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
    customAgentRoleList: async () => [
      {
        id: "role-1",
        name: "Architect",
        systemPrompt: "Focus on architecture.",
      },
    ],
    gitGetBranches: async () => BRANCHES,
    workspaceSessionWorktreesList: async () => ({ worktrees: [] }),
    agentRuntimeLoadCatalog: async () => MODEL_CATALOG,
    ...overrides,
  };
  const connection = createTestClientConnection({ client: hostClient });
  const sessions = createAgentSessionsStore();
  const draft = connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE.workspaceId);
  const saved: Array<{ record: WorkspaceSession; attemptId: string }> = [];
  let discarded = 0;

  function LiveDraftHost() {
    const current = useNewWorkspaceSessionDraft(draft.id);
    if (!current) return null;
    return (
      <WorkspaceSessionDraftView
        workspace={WORKSPACE}
        draft={current}
        onDiscard={() => {
          discarded += 1;
        }}
        onSwitchWorkspace={(workspaceId) => {
          switchedTo.push(workspaceId);
        }}
        onSavedRecord={(record, attemptId) => {
          saved.push({ record, attemptId });
        }}
      />
    );
  }

  const renderView = () =>
    render(
      <MemoryRouter>
        <QueryProvider connection={connection}>
          <ActiveWorkspaceContext
            value={{ activeWorkspace: WORKSPACE, setActiveWorkspace: () => {} }}
          >
            <WorkspaceStateContext
              value={createWorkspaceStateFixture({
                activeWorkspace: WORKSPACE,
                workspaces,
              })}
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
                    <AgentOperationsContext
                      // SAFETY: test double only exercises sendAgentMessage via draft launch recovery.
                      value={{ sendAgentMessage: async () => {} } as never}
                    >
                      <SettingsModalProvider>
                        <WorkspacePreviewTransitionGuardProvider>
                          <LiveDraftHost />
                        </WorkspacePreviewTransitionGuardProvider>
                      </SettingsModalProvider>
                    </AgentOperationsContext>
                  </AgentSessionsContext>
                </HostRuntimeStatusContext>
              </RuntimeDefinitionsContext>
            </WorkspaceStateContext>
          </ActiveWorkspaceContext>
        </QueryProvider>
      </MemoryRouter>,
    );

  return {
    connection,
    sessions,
    draft,
    saved,
    switchedTo,
    getDiscarded: () => discarded,
    renderView,
  };
}

test("omits manual Name input, keeps composer clean across location changes, and puts Manage roles inside role picker", async () => {
  const h = setup();
  const view = h.renderView();
  try {
    expect(view.queryByLabelText(/^Name$/i)).toBeNull();
    expect(view.getByRole("heading", { name: "Start a new session" })).toBeDefined();
    expect(view.getByRole("button", { name: "Workspace: Demo Repo" })).toBeDefined();
    expect(view.queryByRole("button", { name: "Manage roles" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: /Discard/i }));
    expect(h.getDiscarded()).toBe(1);

    fireEvent.click(view.getByRole("button", { name: "Work location" }));
    fireEvent.click(await view.findByText("New worktree"));
    expect(h.connection.drafts.newWorkspaceSessions.getDraft(h.draft.id)?.options.location).toBe(
      "local_worktree",
    );
    expect(view.getByRole("button", { name: "Worktree options: Auto branch" })).toBeDefined();
    await waitFor(() => {
      expect(view.queryByText("Create an isolated branch worktree")).toBeNull();
    });
    fireEvent.click(view.getByRole("button", { name: "Worktree options: Auto branch" }));
    expect(await view.findByLabelText("Branch name")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Custom folder name" }));
    fireEvent.change(await view.findByLabelText("Folder name"), {
      target: { value: "fix-login" },
    });
    expect(view.getByRole("button", { name: "Worktree options: odt/fix-login" })).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Reset" }));
    expect(view.getByRole("button", { name: "Worktree options: Auto branch" })).toBeDefined();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    fireEvent.click(view.getByRole("button", { name: "Work location" }));
    fireEvent.click(await view.findByText("Existing worktree"));
    expect(view.queryByText("Select an existing worktree.")).toBeNull();

    const roleButton = await view.findByRole("button", { name: "Custom role" });
    await waitFor(() => {
      expect(roleButton.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(roleButton);
    expect(await view.findByRole("button", { name: "Manage roles…" })).toBeDefined();
  } finally {
    view.unmount();
    await h.connection.dispose();
  }
});

test("switches workspace from the inline workspace picker when multiple workspaces are open", async () => {
  const h = setup({}, { workspaces: [WORKSPACE, SECOND_WORKSPACE] });
  const view = h.renderView();
  try {
    fireEvent.click(view.getByRole("button", { name: "Workspace: Demo Repo" }));
    fireEvent.click(await view.findByText("Other Repo"));
    expect(h.switchedTo).toEqual([SECOND_WORKSPACE.workspaceId]);
  } finally {
    view.unmount();
    await h.connection.dispose();
  }
});

test("confirms before discarding a retained draft", async () => {
  const h = setup();
  h.connection.drafts.newWorkspaceSessions.updateOptions(h.draft.id, {
    location: "local_worktree",
  });
  const view = h.renderView();
  try {
    fireEvent.click(view.getByRole("button", { name: /Discard/i }));
    expect(view.getByText("Discard draft session?")).toBeDefined();
    expect(h.getDiscarded()).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Discard draft" }));
    expect(h.getDiscarded()).toBe(1);
  } finally {
    view.unmount();
    await h.connection.dispose();
  }
});

test("submits deferred workspace_session_launch and hands off on host save", async () => {
  const requests: WorkspaceSessionLaunchRequest[] = [];
  let live!: ReturnType<typeof createStartupLiveSourceFake>;
  const record: WorkspaceSession = {
    id: "saved-session-1",
    runtimeKind: "codex",
    externalSessionId: "native-1",
    executionTarget: { kind: "local_repo_root", workingDirectory: WORKSPACE.repoPath },
    roleSnapshot: null,
    selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
    generatedTitle: "Inspect draft launch",
    manualTitle: null,
    targetBranch: { remote: "origin", branch: "main" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
  const h = setup({
    workspaceSessionLaunch: async (request): Promise<WorkspaceSessionLaunchResult> => {
      requests.push(request);
      const runtimeSession = {
        externalSessionId: "native-1",
        runtimeKind: "codex" as const,
        workingDirectory: WORKSPACE.repoPath,
        startedAt: "2026-10-27T00:00:00.000Z",
        status: "idle" as const,
      };
      return {
        workspaceId: WORKSPACE.workspaceId,
        repoPath: WORKSPACE.repoPath,
        status: "completed",
        sessionId: record.id,
        record,
        session: runtimeSession,
        startupProgress: request.startup
          ? {
              ...live.prepared({
                context: request.startup,
                workspaceId: WORKSPACE.workspaceId,
                repoPath: WORKSPACE.repoPath,
                scope: { kind: "workspace", sessionId: record.id, draftId: request.draftId },
                ownership: {
                  state: "saved",
                  target: { kind: "workspace", record, runtimeSession },
                },
              }),
              steps: [
                {
                  id: "checkout",
                  label: "Use current checkout",
                  state: "completed",
                  details: [WORKSPACE.repoPath],
                },
                { id: "prepare", label: "Start session", state: "completed", details: [] },
                {
                  id: "instruction",
                  label: "Submit initial instruction",
                  state: "completed",
                  details: [],
                },
              ],
            }
          : undefined,
      };
    },
  });
  live = createStartupLiveSourceFake(h.connection.queryClient);
  const view = h.renderView();
  try {
    const editor = view.container.querySelector("[data-composer-editor]");
    if (!(editor instanceof HTMLElement)) throw new Error("Expected composer editor");
    await waitFor(
      () => {
        expect(editor.getAttribute("contenteditable")).toBe("true");
      },
      { timeout: 400 },
    );
    await act(async () => {
      editor.textContent = "Inspect draft launch";
      fireEvent.input(editor);
    });
    const sendButton = await view.findByRole("button", { name: "Send message" }, { timeout: 400 });
    await waitFor(
      () => {
        expect(sendButton.hasAttribute("disabled")).toBe(false);
      },
      { timeout: 400 },
    );
    await act(async () => {
      fireEvent.click(sendButton);
    });
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 400 });
    expect(requests[0]?.draftId).toBe(h.draft.id);
    expect(requests[0]?.location).toBe("local_repo_root");
    await waitFor(() => expect(h.saved).toHaveLength(1), { timeout: 400 });
    expect(h.saved[0]?.record.id).toBe(record.id);
    expect(h.connection.drafts.newWorkspaceSessions.getDraft(h.draft.id)).toBeNull();
  } finally {
    view.unmount();
    live.dispose();
    await h.connection.dispose();
  }
});

test("blocks sending session-requiring system slash commands in a new session draft", async () => {
  const h = setup();
  h.connection.drafts.newWorkspaceSessions.updateComposer(h.draft.id, {
    segments: [
      { kind: "slash_command", id: "cmd-1", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND },
    ],
    attachments: [],
  });
  const view = h.renderView();
  try {
    const sendButton = await view.findByRole("button", { name: "Send message" }, { timeout: 400 });
    expect(sendButton.hasAttribute("disabled")).toBe(true);
    expect(
      await view.findByText(/\/compact requires an existing session/i, {}, { timeout: 400 }),
    ).toBeDefined();
  } finally {
    view.unmount();
    await h.connection.dispose();
  }
});

test("reopening a failed draft whose attempt is in notification restores inline trace and recovery actions", async () => {
  const h = setup();
  let retried = 0;
  const attemptId = h.connection.startupAttempts.begin({
    origin: {
      workspaceId: WORKSPACE.workspaceId,
      repoPath: WORKSPACE.repoPath,
      scope: { kind: "workspace", draftId: h.draft.id },
    },
    label: "Background draft",
    presentation: "notification",
    instructionRequired: true,
    submittedComposer: {
      segments: [{ id: "t1", kind: "text", text: "Background draft" }],
      attachments: [],
    },
  });
  h.connection.startupAttempts.fail(attemptId, "Worktree creation failed.", true);
  h.connection.startupAttempts.setRecoveryActions(attemptId, [
    {
      kind: "edit_choices",
      label: "Edit choices",
      run: () => {
        h.connection.startupAttempts.release(attemptId);
      },
    },
    {
      kind: "retry",
      label: "Retry",
      run: () => {
        retried += 1;
      },
    },
  ]);

  const view = h.renderView();
  try {
    await waitFor(
      () => {
        expect(h.connection.startupAttempts.getAttempt(attemptId)?.presentation).toBe("inline");
      },
      { timeout: 400 },
    );
    const editButton = await view.findByRole("button", { name: "Edit choices" }, { timeout: 400 });
    const retryButton = await view.findByRole("button", { name: "Retry" }, { timeout: 400 });
    expect(editButton).toBeDefined();
    expect(retryButton).toBeDefined();
    fireEvent.click(retryButton);
    await waitFor(() => expect(retried).toBe(1), { timeout: 400 });
  } finally {
    view.unmount();
    await h.connection.dispose();
  }
});
