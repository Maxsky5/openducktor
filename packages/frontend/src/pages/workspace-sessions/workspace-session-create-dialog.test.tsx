import { expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionCreateResult,
  type WorkspaceSession,
  type AgentSessionLiveEnvelope,
  type WorkspaceSessionStartInput,
  type WorkspaceSessionStartResult,
  type StartupOperationContext,
  type StartupOperationSnapshot,
  repoConfigSchema,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { HostInvokeError, type HostClient } from "@openducktor/host-client";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act, type ComponentProps, useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { gitQueryKeys } from "@openducktor/frontend-core/queries/git";
import { RuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ChecksStateContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import {
  createHostRuntimeStatusContextValue,
  createObservedCheckFixture,
  createRuntimeCatalogFixture,
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import { AppToaster, StartupNotifications } from "@/features/session-startup/session-startup-stack";
import { WorkspaceSessionCreateDialog } from "./workspace-session-create-dialog";

function renderCreation(
  create: (
    input: WorkspaceSessionCreateInput,
    startup: StartupOperationContext | undefined,
  ) => Promise<WorkspaceSessionCreateResult>,
  onClose = () => {},
  onCreated: (session: WorkspaceSession) => void = () => {
    throw new Error("Unexpected successful creation");
  },
  clientOverrides: Partial<HostClient> = {},
) {
  const snapshot = createSettingsSnapshotFixture();
  const workspace = createWorkspaceRecordFixture({
    workspaceId: "A",
    workspaceName: "A",
    repoPath: "/repo",
  });
  let savedRecord: WorkspaceSession | null = null;
  const catalog: AgentModelCatalog = {
    runtime: OPENCODE_RUNTIME_DESCRIPTOR,
    models: [
      {
        id: "provider/model",
        providerId: "provider",
        providerName: "Provider",
        modelId: "model",
        modelName: "Test model",
        variants: ["low", "high"],
      },
    ],
    defaultModelsByProvider: {},
    profiles: [{ name: "runtime-profile", mode: "primary", hidden: false }],
  };
  const workspaceState: ComponentProps<typeof WorkspaceStateContext>["value"] = {
    isSwitchingWorkspace: false,
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded: false,
    workspaces: [workspace],
    closedWorkspaces: [],
    incompleteRemovals: [],
    activeWorkspace: workspace,
    branches: [],
    activeBranch: null,
    commitWorkspaceProviderSetup: async () => {
      throw new Error("Not used");
    },
    addWorkspace: async () => {
      throw new Error("Not used");
    },
    saveWorkspaceModelDefaults: async () => {
      throw new Error("Not used");
    },
    selectWorkspace: async () => {},
    closeWorkspace: async () => {},
    removeWorkspace: async () => {},
    reopenWorkspace: async () => {},
    resolveWorkspacePath: async () => {
      throw new Error("Unexpected path resolution");
    },
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("Unexpected settings read");
    },
    saveRepoSettings: async () => {
      throw new Error("Unexpected settings save");
    },
    loadSettingsSnapshot: async () => snapshot,
    detectGithubRepository: async () => null,
    saveGlobalGitConfig: async () => {},
    previewSettingsSnapshotRuntime: async () => ({ impact: null }),
    saveSettingsSnapshot: async () => ({
      type: "saved" as const,
      workspaces: [],
      runtimeApplications: [],
      refreshError: null,
    }),
    saveAgentModelFavorites: async () => snapshot,
  };
  const definitions: ComponentProps<typeof RuntimeDefinitionsContext>["value"] = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: async () => createRuntimeCatalogFixture({ models: catalog }),
    loadRepoRuntimeFileSearch: async () => [],
  };
  let publishProgress: (snapshot: StartupOperationSnapshot) => void = () => {
    throw new Error("Startup progress is not subscribed.");
  };
  const host = createTestHostConnection({
    subscribeStartupProgress: async (listener) => {
      publishProgress = (snapshot) =>
        listener({ channel: "openducktor://session-startup-progress", payload: snapshot });
      return () => {};
    },
    client: {
      workspaceGetSettingsSnapshot: async () => snapshot,
      workspaceGetRepoConfig: async () =>
        repoConfigSchema.parse({
          workspaceId: "a",
          workspaceName: "A",
          repoPath: "/repo",
          branchPrefix: "odt",
        }),
      gitGetBranches: async () => [
        { name: "main", isRemote: false, isCurrent: true, worktreePath: "/repo" },
        {
          name: "feature/occupied",
          isRemote: false,
          isCurrent: false,
          worktreePath: "/other checkout",
        },
        { name: "feature/existing", isRemote: false, isCurrent: false },
        { name: "origin/remote-only", isRemote: true, isCurrent: false },
      ],
      customAgentRoleList: async () => [
        { id: "alpha", name: "Alpha", systemPrompt: "Alpha prompt" },
        { id: "zeta", name: "Zeta", systemPrompt: "Zeta prompt" },
      ],
      workspaceSessionCreate: async ({ startup, ...input }) => {
        try {
          const result = await create(input, startup);
          savedRecord = result.session;
          return result;
        } catch (cause) {
          if (!startup) throw cause;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          const startupProgress = {
            context: startup,
            hostInstanceId: "host",
            revision: 1,
            workspaceId: input.workspaceId,
            repoPath: "/repo",
            scope: { kind: "workspace" as const },
            phase: "failed" as const,
            ownership: { state: "not_saved" as const },
            steps: [],
          };
          throw new HostInvokeError(
            error.message,
            {
              ...(error instanceof HostInvokeError && error.failure
                ? error.failure
                : { kind: "session_startup" as const }),
              startupProgress,
            },
            error,
          );
        }
      },
      workspaceSessionStart: async (input) => {
        if (!savedRecord || !input.startup) throw new Error("No saved session to prepare.");
        const session = { ...savedRecord, externalSessionId: "prepared-session" };
        const runtimeSession = {
          runtimeKind: session.runtimeKind,
          workingDirectory: session.executionTarget.workingDirectory,
          externalSessionId: session.externalSessionId,
          startedAt: "2026-10-26T00:00:00.000Z",
          status: "idle" as const,
        };
        return {
          session,
          runtimeSession,
          startupProgress: live.prepared({
            context: input.startup,
            workspaceId: input.workspaceId,
            repoPath: "/repo",
            scope: { kind: "workspace" },
            ownership: {
              state: "saved",
              target: { kind: "workspace", record: session, runtimeSession },
            },
          }),
        };
      },
      ...clientOverrides,
    },
  });
  const connection = createTestClientConnection({ host });
  const queryClient = connection.queryClient;
  const live = createStartupLiveSourceFake(queryClient);
  function Creation() {
    const [open, setOpen] = useState(true);
    const location = useLocation();
    return (
      <>
        <output aria-label="Current location">
          {location.pathname}
          {location.search}
        </output>
        <AppToaster />
        <StartupNotifications />
        {open ? (
          <WorkspaceSessionCreateDialog
            workspace={workspace}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            onCreated={onCreated}
          />
        ) : null}
      </>
    );
  }
  const view = render(
    <MemoryRouter>
      <WorkspacePreviewTransitionGuardProvider>
        <QueryProvider connection={connection}>
          <AgentSessionsContext value={createAgentSessionsStore("/repo")}>
            <WorkspaceStateContext value={workspaceState}>
              <ChecksStateContext
                value={{
                  pathCheck: createObservedCheckFixture(),
                  gitCheck: createObservedCheckFixture(),
                  checksRepoPath: null,
                  taskStoreCheck: createObservedCheckFixture(),
                  isRefreshingChecks: false,
                  refreshChecks: async () => {},
                }}
              >
                <RuntimeDefinitionsContext value={definitions}>
                  <HostRuntimeStatusContext value={createHostRuntimeStatusContextValue()}>
                    <Creation />
                  </HostRuntimeStatusContext>
                </RuntimeDefinitionsContext>
              </ChecksStateContext>
            </WorkspaceStateContext>
          </AgentSessionsContext>
        </QueryProvider>
      </WorkspacePreviewTransitionGuardProvider>
    </MemoryRouter>,
  );
  return {
    ...view,
    connection,
    queryClient,
    publishProgress: (snapshot: StartupOperationSnapshot) => publishProgress(snapshot),
    publishLive: (envelope: AgentSessionLiveEnvelope) => live.publish("/repo", envelope),
    unmount: () => {
      view.unmount();
      live.dispose();
    },
  };
}

test("opening a saved failed current-checkout creation retains feedback and session inspection", async () => {
  const session: WorkspaceSession = {
    id: "retained-created",
    runtimeKind: "opencode",
    externalSessionId: "native-created",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    targetBranch: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  const create = mock(async () => ({ session }));
  let starts = 0;
  let closes = 0;
  const view = renderCreation(
    create,
    () => {
      closes += 1;
    },
    () => {
      throw new Error("A failed start must not hand off automatically.");
    },
    {
      workspaceSessionStart: async (input) => {
        starts += 1;
        if (!input.startup) throw new Error("Missing startup context.");
        throw new HostInvokeError("Session setup failed. Inspect the saved session.", {
          kind: "session_startup",
          startupProgress: {
            context: input.startup,
            hostInstanceId: "host",
            revision: 1,
            workspaceId: "A",
            repoPath: "/repo",
            scope: { kind: "workspace" },
            phase: "failed",
            ownership: { state: "saved", target: { kind: "workspace", record: session } },
            prepared: {
              ref: {
                repoPath: "/repo",
                runtimeKind: "opencode",
                externalSessionId: "native-created",
                workingDirectory: "/repo",
              },
              runtimeId: "runtime",
              liveStateSequence: 1,
            },
            steps: [
              {
                id: "checkout",
                label: "Reuse checkout",
                state: "completed",
                details: ["Reused /repo."],
              },
            ],
          },
        });
      },
    },
  );
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    const open = await view.findByRole("button", { name: "Open session" }, { timeout: 800 });
    const original = view.connection.startupAttempts.getSnapshot()[0];
    if (!original) throw new Error("Creation attempt is missing.");
    await act(async () => {
      fireEvent.click(open);
    });
    expect(closes).toBe(1);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByLabelText("Current location").textContent).toBe(
      "/sessions?workspace=A&kind=workspace&session=retained-created",
    );
    expect(view.connection.startupAttempts.getAttempt(original.id)).toMatchObject({
      id: original.id,
      presentation: "notification",
      status: { phase: "failed" },
      operations: original.operations,
    });
    expect(await view.findByRole("region", { name: /^Notifications/ })).toBeDefined();
    expect(view.queryByRole("button", { name: "View progress" })).toBeNull();
    expect(view.queryByText(/\d+\/\d+ steps/)).toBeNull();
    fireEvent.click(await view.findByRole("button", { name: "Details" }));
    const inspect = await view.findByRole("button", { name: "Inspect saved session" });
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    expect(view.queryByText("Reuse checkout")).toBeNull();
    fireEvent.click(inspect);
    expect(view.getByText("retained-created")).toBeDefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(starts).toBe(1);
  } finally {
    view.unmount();
    await view.connection.dispose();
  }
});

function worktreeOf(input: WorkspaceSessionCreateInput | undefined) {
  return input?.location === "local_worktree" ? input.worktree : undefined;
}

async function selectModel(view: ReturnType<typeof renderCreation>) {
  fireEvent.click(view.getByRole("button", { name: "Select model, Select a model" }));
  const choice = await view.findByRole(
    "button",
    { name: "Select Test model model" },
    { timeout: 800 },
  );
  fireEvent.click(choice);
  await waitFor(
    () =>
      expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(
        false,
      ),
    { timeout: 800 },
  );
}

async function selectTarget(view: ReturnType<typeof renderCreation>, name: RegExp) {
  fireEvent.click(view.getByRole("button", { name: "Target branch" }));
  fireEvent.click(await view.findByRole("option", { name }, { timeout: 800 }));
}

/** Opens the Target branch list, runs the checks, and closes the list. */
function inTargetOptions(view: ReturnType<typeof renderCreation>, check: () => void) {
  fireEvent.click(view.getByRole("button", { name: "Target branch" }));
  try {
    check();
  } finally {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  }
}

test("preselects the repository default target, marks it, and sends it", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    await waitFor(() =>
      inTargetOptions(view, () => {
        expect(view.getByRole("option", { name: /^origin\/remote-only/ })).toBeTruthy();
        const defaultOption = view.getByRole("option", { name: /^origin\/main/ });
        expect(within(defaultOption).getByText("default")).toBeTruthy();
        expect(view.getByRole("option", { name: /^Tracked upstream/ })).toBeTruthy();
      }),
    );
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]?.targetBranch).toEqual({ remote: "origin", branch: "main" });
  } finally {
    view.unmount();
  }
});

test("New worktree hides Tracked upstream and returns an upstream pick to the default", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    await selectTarget(view, /^Tracked upstream/);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    expect(view.getByText("Creates a new branch from the target branch.")).not.toBeNull();
    inTargetOptions(view, () =>
      expect(view.queryByRole("option", { name: /^Tracked upstream/ })).toBeNull(),
    );
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]?.targetBranch).toEqual({ remote: "origin", branch: "main" });
    fireEvent.click(await view.findByRole("button", { name: "Edit choices" }));
    fireEvent.click(view.getByRole("radio", { name: /Current checkout/ }));
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(2), { timeout: 800 });
    expect(requests[1]?.location).toBe("local_repo_root");
    expect(requests[1]?.targetBranch).toEqual({ remote: "origin", branch: "main" });
  } finally {
    view.unmount();
  }
});

test("sends a picked local target and keeps it across a location change", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    await selectTarget(view, /^feature\/existing/);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]?.targetBranch).toEqual({ branch: "feature/existing" });
  } finally {
    view.unmount();
  }
});

test("matches the task modal width and footer surface, separates actions and disables name autocomplete", () => {
  const view = renderCreation(async () => {
    throw new Error("Unexpected creation");
  });
  try {
    expect(view.getByRole("dialog").classList.contains("sm:max-w-2xl")).toBe(true);
    expect(view.getByLabelText("Name optional").getAttribute("autocomplete")).toBe("off");
    const cancel = view.getByRole("button", { name: "Cancel" });
    const create = view.getByRole("button", { name: "Create chat" });
    expect(cancel.parentElement).toBe(create.parentElement);
    expect(cancel.parentElement?.firstElementChild).toBe(cancel);
    expect(cancel.parentElement?.classList.contains("justify-between")).toBe(true);
    expect(cancel.parentElement?.classList.contains("sm:justify-between")).toBe(true);
    // Sticky actions need the same opaque surface as the dialog in both themes.
    expect(cancel.parentElement?.classList.contains("bg-popover")).toBe(true);
  } finally {
    view.unmount();
  }
});

test("omits checkout help text for both work locations", () => {
  const view = renderCreation(async () => {
    throw new Error("Unexpected creation");
  });
  try {
    expect(view.queryByText("Changes apply directly to this workspace checkout.")).toBeNull();
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    expect(view.queryByText("Uncommitted changes stay in the current checkout.")).toBeNull();
    expect(view.getByLabelText("Worktree name")).not.toBeNull();
  } finally {
    view.unmount();
  }
});

test("uses the task modal label-to-control gap for every form field", async () => {
  const view = renderCreation(async () => {
    throw new Error("Unexpected creation");
  });
  try {
    await selectModel(view);
    const fields = [
      view.getByLabelText("Name optional").parentElement,
      view.getByText("Runtime and model").parentElement,
      view.getByText("Effort", { selector: "label" }).parentElement,
      view.getByText("Runtime profile", { selector: "label" }).parentElement,
      view.getByText("Custom role", { exact: false, selector: "label" }).parentElement,
    ];
    for (const field of fields) {
      expect(field?.classList.contains("grid")).toBe(true);
      expect(field?.classList.contains("gap-1.5")).toBe(true);
      expect(field?.classList.contains("space-y-2")).toBe(false);
    }
    const roleSelect = view.getByRole("button", { name: "Custom role optional" });
    const manageRoles = view.getByRole("button", { name: "Manage roles" });
    expect(manageRoles.classList.contains("h-9")).toBe(true);
    expect(roleSelect.parentElement).toBe(manageRoles.parentElement);
    expect(roleSelect.parentElement?.classList.contains("grid-cols-[minmax(0,1fr)_auto]")).toBe(
      true,
    );
    expect(roleSelect.compareDocumentPosition(manageRoles) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  } finally {
    view.unmount();
  }
});

test("a current-checkout creation keeps simple status and failure feedback until Edit choices", async () => {
  let rejectCreation!: (cause: Error) => void;
  let created = 0;
  let closed = 0;
  const view = renderCreation(
    () =>
      new Promise<never>((_resolve, reject) => {
        rejectCreation = reject;
      }),
    () => {
      closed += 1;
    },
    () => {
      created += 1;
    },
  );
  try {
    await selectModel(view);
    const name = view.getByLabelText("Name optional");
    fireEvent.change(name, { target: { value: "Retained session" } });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    });
    expect(view.getByText("Submitting request")).toBeDefined();
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    expect(view.queryByText(/\d+ of \d+ steps/)).toBeNull();
    await act(async () => {
      rejectCreation(new Error("Runtime startup failed: executable missing"));
    });
    await view.findByRole("alert", {}, { timeout: 800 });
    expect(view.getByRole("alert").textContent).toBe("Runtime startup failed: executable missing");
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    expect(view.queryByRole("button", { name: "Create chat" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Edit choices" }));
    expect(view.getByDisplayValue("Retained session") !== null).toBe(true);
    expect(view.getByLabelText("Name optional").closest("fieldset")?.disabled).toBe(false);
    expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(false);
    expect(
      view
        .getByRole("button", { name: "Select model, OpenCode, Test model" })
        .getAttribute("aria-disabled"),
    ).toBe("false");
    expect(created).toBe(0);
    expect(closed).toBe(0);
  } finally {
    view.unmount();
  }
});

test("retries preparation of the saved draft and waits for native live evidence before handoff", async () => {
  const draft: WorkspaceSession = {
    id: "retained-draft",
    runtimeKind: "opencode",
    externalSessionId: null,
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    targetBranch: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  const create = mock(async () => ({ session: draft }));
  const starts: WorkspaceSessionStartInput[] = [];
  const handedOff: WorkspaceSession[] = [];
  const prepared = Promise.withResolvers<WorkspaceSessionStartResult>();
  const view = renderCreation(
    create,
    () => {},
    (record) => {
      handedOff.push(record);
    },
    {
      workspaceSessionStart: async (input) => {
        starts.push(input);
        if (!input.startup) throw new Error("Startup context is missing.");
        if (starts.length === 1)
          throw new HostInvokeError("Runtime preparation failed. Check the runtime and retry.", {
            kind: "session_startup",
            startupProgress: {
              context: input.startup,
              hostInstanceId: "host",
              revision: 1,
              workspaceId: input.workspaceId,
              repoPath: "/repo",
              scope: { kind: "workspace", sessionId: draft.id },
              phase: "failed",
              ownership: { state: "saved", target: { kind: "workspace", record: draft } },
              steps: [{ id: "prepare", label: "Prepare session", state: "failed", details: [] }],
            },
          });
        return prepared.promise;
      },
    },
  );
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    const retry = await view.findByRole(
      "button",
      { name: "Retry session preparation" },
      { timeout: 800 },
    );
    expect(view.queryByRole("button", { name: "Edit choices" })).toBeNull();
    expect(view.queryByRole("button", { name: "Open session" })).toBeNull();
    expect(handedOff).toEqual([]);
    fireEvent.click(retry);
    await waitFor(() => expect(starts).toHaveLength(2), { timeout: 800 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(starts.map((input) => input.sessionId)).toEqual([draft.id, draft.id]);
    const session = { ...draft, externalSessionId: "prepared-native" };
    const ref = {
      repoPath: "/repo",
      runtimeKind: session.runtimeKind,
      workingDirectory: "/repo",
      externalSessionId: session.externalSessionId,
    };
    const startedAt = "2026-10-26T00:00:00.000Z";
    const runtimeSession = {
      externalSessionId: session.externalSessionId,
      runtimeKind: session.runtimeKind,
      workingDirectory: "/repo",
      startedAt,
      status: "idle" as const,
    };
    const startup = starts[1]?.startup;
    if (!startup) throw new Error("Repair startup context is missing.");
    await act(async () => {
      prepared.resolve({
        session,
        runtimeSession,
        startupProgress: {
          context: startup,
          hostInstanceId: "host",
          revision: 1,
          workspaceId: "A",
          repoPath: "/repo",
          scope: { kind: "workspace", sessionId: draft.id },
          phase: "completed",
          ownership: {
            state: "saved",
            target: { kind: "workspace", record: session, runtimeSession },
          },
          prepared: { ref, runtimeId: "runtime", liveStateSequence: 5 },
          steps: [{ id: "prepare", label: "Prepare session", state: "completed", details: [] }],
        },
      });
    });
    expect(handedOff).toEqual([]);
    expect(view.queryByRole("button", { name: "Retry session preparation" })).toBeNull();
    await act(async () => {
      view.publishLive({
        type: "session_upsert",
        sequence: 5,
        session: {
          ref,
          activity: "idle",
          title: "Prepared session",
          startedAt,
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        },
      });
    });
    await waitFor(() => expect(handedOff).toHaveLength(1), { timeout: 800 });
    expect(handedOff[0]?.id).toBe(draft.id);
    expect(handedOff[0]?.externalSessionId).toBe("prepared-native");
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});

test("creation keeps Role, Runtime Profile, Effort and location separate and blocks duplicate pending input", async () => {
  const requests: {
    input: WorkspaceSessionCreateInput;
    startup: StartupOperationContext | undefined;
  }[] = [];
  let closed = 0;
  const view = renderCreation(
    async (input, startup) => {
      requests.push({ input, startup });
      return new Promise<never>(() => {});
    },
    () => {
      closed += 1;
    },
  );
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("button", { name: "Custom role optional" }));
    expect(view.getAllByRole("option").map((entry) => entry.textContent?.trim())).toEqual([
      "No role",
      "Alpha",
      "Zeta",
    ]);
    fireEvent.click(view.getByRole("option", { name: "Alpha" }));
    fireEvent.click(view.getByRole("button", { name: "Runtime profile" }));
    fireEvent.click(view.getByRole("option", { name: "runtime-profile" }));
    fireEvent.click(view.getByRole("button", { name: "Effort" }));
    fireEvent.click(view.getByRole("option", { name: "high" }));
    fireEvent.change(view.getByLabelText("Name optional"), { target: { value: "My session" } });
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    });
    await waitFor(() => expect(requests.length).toBe(1), { timeout: 800 });
    expect(requests[0]?.input).toEqual({
      workspaceId: "A",
      runtimeKind: "opencode",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "provider",
        modelId: "model",
        variant: "high",
        profileId: "runtime-profile",
      },
      customAgentRoleId: "alpha",
      location: "local_worktree",
      worktree: { mode: "from_name", name: "my-feature", branchName: null },
      manualTitle: "My session",
      targetBranch: { remote: "origin", branch: "main" },
    });
    expect(view.queryByLabelText("Name optional")).toBeNull();
    expect(view.queryByRole("button", { name: "Create chat" })).toBeNull();
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    const startup = requests[0]?.startup;
    if (!startup) throw new Error("Creation startup context is missing.");
    await act(async () => {
      view.publishProgress({
        context: startup,
        hostInstanceId: "host",
        revision: 1,
        workspaceId: "A",
        repoPath: "/repo",
        scope: { kind: "workspace" },
        phase: "running",
        ownership: { state: "not_saved" },
        steps: [
          { id: "checkout", label: "Create worktree", state: "pending", details: [] },
          { id: "copies", label: "Copy configured files", state: "pending", details: [] },
          { id: "save", label: "Save session", state: "pending", details: [] },
        ],
      });
    });
    expect(view.getByRole("list", { name: "Session startup steps" })).toBeDefined();
    expect(view.getByText("Create worktree")).toBeDefined();
    expect(view.queryByText("Copy configured files")).toBeNull();
    expect(view.queryByText("Save session")).toBeNull();
    expect(view.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(requests.length).toBe(1);
    expect(closed).toBe(0);
  } finally {
    view.unmount();
  }
});

test("shows the repository defaults read failure, keeps a target pick usable and retries", async () => {
  let readAttempts = 0;
  const view = renderCreation(
    async () => {
      throw new Error("Unexpected creation");
    },
    () => {},
    () => {
      throw new Error("Unexpected successful creation");
    },
    {
      workspaceGetRepoConfig: async () => {
        readAttempts += 1;
        if (readAttempts === 1) throw new Error("Settings file is unreadable.");
        return repoConfigSchema.parse({
          workspaceId: "a",
          workspaceName: "A",
          repoPath: "/repo",
          branchPrefix: "odt",
        });
      },
    },
  );
  try {
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain(
      "The repository Default Model and default target branch could not load.",
    );
    expect(alert.textContent).toContain("Settings file is unreadable.");
    expect(readAttempts).toBe(1);
    await selectTarget(view, /^main/);
    await selectModel(view);
    fireEvent.click(view.getByRole("button", { name: "Retry repository defaults" }));
    await waitFor(() => expect(view.queryByRole("alert") === null).toBe(true), { timeout: 800 });
    expect(readAttempts).toBe(2);
  } finally {
    view.unmount();
  }
});

test("creates a worktree chat with one request and no confirmation step", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  let created = 0;
  const view = renderCreation(
    async (input) => {
      requests.push(input);
      return {
        session: {
          id: "created-chat",
          runtimeKind: input.runtimeKind,
          externalSessionId: null,
          executionTarget: {
            kind: "local_worktree",
            workingDirectory: "/worktrees/my-feature",
            branchName: "odt/my-feature",
            worktreeState: "present",
          },
          selectedModel: input.selectedModel,
          roleSnapshot: null,
          generatedTitle: null,
          manualTitle: null,
          targetBranch: input.targetBranch,
          createdAt: 1000,
          updatedAt: 1000,
          archivedAt: null,
        },
      };
    },
    () => {},
    () => {
      created += 1;
    },
  );
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(created).toBe(1), { timeout: 800 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("confirmUncommittedChanges");
    expect(worktreeOf(requests[0])).toEqual({
      mode: "from_name",
      name: "my-feature",
      branchName: null,
    });
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByRole("button", { name: "Create without uncommitted changes" })).toBeNull();
  } finally {
    view.unmount();
  }
  // This flow renders the create dialog and waits for host reads.
}, 2_500);

test("requires a safe worktree name and sends an optional custom branch from Advanced", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    const create = view.getByRole("button", { name: "Create chat" });
    expect(create.hasAttribute("disabled")).toBe(true);
    expect(view.queryByLabelText("Branch name optional")).toBeNull();
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "../escape" } });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "review-ui" } });
    await view.findByText("odt/review-ui", {}, { timeout: 800 });
    fireEvent.click(view.getByRole("button", { name: "Advanced" }));
    const branch = view.getByLabelText("Branch name optional");
    expect(branch.getAttribute("placeholder")).toBe("odt/review-ui");
    fireEvent.change(branch, { target: { value: "bad branch" } });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(branch, { target: { value: "feature/custom-ui" } });
    fireEvent.click(create);
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(worktreeOf(requests[0])).toEqual({
      mode: "from_name",
      name: "review-ui",
      branchName: "feature/custom-ui",
    });
  } finally {
    view.unmount();
  }
  // This flow renders the create dialog and waits for host reads.
}, 2_500);

test("Existing branch accepts slash-separated worktree names and submits a safe directory name", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    const tabList = view.getByRole("tablist", { name: "Worktree creation mode" });
    expect(tabList.classList.contains("bg-muted")).toBe(true);
    expect(tabList.classList.contains("border-b")).toBe(false);
    expect(view.getByRole("tab", { name: "New branch" }).className).toContain(
      "data-[state=active]:bg-selected-control",
    );
    expect(view.getByRole("tab", { name: "New branch" })).not.toBeNull();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Existing branch" }), {
      button: 0,
      ctrlKey: false,
    });
    const selector = await view.findByRole("button", { name: "Existing branch" }, { timeout: 800 });
    await waitFor(() => expect(selector.hasAttribute("disabled")).toBe(false), { timeout: 800 });
    fireEvent.click(selector);
    expect(view.queryByRole("option", { name: /origin\/remote-only/ })).toBeNull();
    for (const name of [/main/, /feature\/occupied/]) {
      const option = view.getByRole("option", { name });
      expect(option.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(option);
      expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(true);
    }
    fireEvent.click(view.getByRole("option", { name: /feature\/existing/ }));
    expect(view.getByDisplayValue("feature-existing")).not.toBeNull();
    expect(view.queryByRole("button", { name: "Advanced" })).toBeNull();
    fireEvent.change(view.getByLabelText("Worktree name"), {
      target: { value: "feat/add-facebook-login" },
    });
    expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(false);
    expect(view.getByText("feat-add-facebook-login")).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(worktreeOf(requests[0])).toEqual({
      mode: "from_branch",
      name: "feat-add-facebook-login",
      branchName: "feature/existing",
    });
  } finally {
    view.unmount();
  }
  // This flow renders the create dialog and waits for host reads.
}, 2_500);

test("blocks submission when refreshed data shows the selected branch is now checked out", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Unexpected creation");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.mouseDown(view.getByRole("tab", { name: "Existing branch" }), {
      button: 0,
      ctrlKey: false,
    });
    const selector = await view.findByRole("button", { name: "Existing branch" });
    await waitFor(() => expect(selector.hasAttribute("disabled")).toBe(false));
    fireEvent.click(selector);
    fireEvent.click(view.getByRole("option", { name: /feature\/existing/ }));
    const create = view.getByRole("button", { name: "Create chat" });
    expect(create.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      view.queryClient.setQueryData(gitQueryKeys.branches("/repo"), [
        {
          name: "feature/existing",
          isCurrent: false,
          isRemote: false,
          worktreePath: "/another checkout",
        },
      ]);
    });
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(true));
    expect(view.getByRole("alert").textContent).toContain(
      "already checked out at /another checkout",
    );
    const form = create.closest("form");
    if (!form) throw new Error("Creation form is missing");
    fireEvent.submit(form);
    expect(requests).toEqual([]);
  } finally {
    view.unmount();
  }
});

test.each(["worktree.name", "worktree.branchName"] as const)(
  "shows host validation next to %s and clears it after a worktree edit",
  async (field) => {
    const message =
      field === "worktree.name"
        ? "Worktree directory already exists. Choose another name."
        : "Branch already exists. Choose another name or use Existing branch.";
    const requests: WorkspaceSessionCreateInput[] = [];
    const view = renderCreation(async (input) => {
      requests.push(input);
      throw new HostInvokeError(message, { kind: "workspace_session_validation", field });
    });
    try {
      await selectModel(view);
      fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
      const name = view.getByLabelText("Worktree name");
      fireEvent.change(name, { target: { value: "collision" } });
      fireEvent.click(view.getByRole("button", { name: "Create chat" }));
      fireEvent.click(await view.findByRole("button", { name: "Edit choices" }));
      const alert = await view.findByRole("alert");
      expect(alert.textContent).toBe(message);
      expect(alert.id).toBe(
        field === "worktree.name"
          ? "workspace-session-worktree-name-error"
          : "workspace-session-branch-error",
      );
      if (field === "worktree.name")
        expect(view.getByLabelText("Worktree name").getAttribute("aria-invalid")).toBe("true");
      fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "another-name" } });
      expect(view.queryByRole("alert")).toBeNull();
      expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(
        false,
      );
      expect(requests).toHaveLength(1);
    } finally {
      view.unmount();
    }
  },
);

test("returning to Current checkout omits all worktree options", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    fireEvent.click(view.getByRole("radio", { name: /Current checkout/ }));
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]?.location).toBe("local_repo_root");
    expect(requests[0]).not.toHaveProperty("worktree");
  } finally {
    view.unmount();
  }
});

test("Existing worktree requires an explicit pick and sends only the selected directory", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  let reads = 0;
  const view = renderCreation(
    async (input) => {
      requests.push(input);
      throw new Error("Keep form open");
    },
    () => {},
    () => {
      throw new Error("Unexpected successful creation");
    },
    {
      workspaceSessionWorktreesList: async () => {
        reads += 1;
        return {
          worktrees: [
            { workingDirectory: "/worktrees/one", branchName: "feature/one" },
            { workingDirectory: "/worktrees/two", branchName: null },
          ],
        };
      },
    },
  );
  try {
    await selectModel(view);
    await selectTarget(view, /^Tracked upstream/);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "unused" } });
    expect(reads).toBe(0);
    fireEvent.click(view.getByRole("radio", { name: /Existing worktree/ }));
    expect(view.getByText("Chats that use this worktree share its files and branch.")).toBeTruthy();
    expect(view.queryByLabelText("Worktree name")).toBeNull();
    inTargetOptions(view, () =>
      expect(view.queryByRole("option", { name: /^Tracked upstream/ })).toBeNull(),
    );
    const selector = view.getByRole("button", { name: "Worktree" });
    await waitFor(() => expect(selector.hasAttribute("disabled")).toBe(false), { timeout: 800 });
    expect(reads).toBe(1);
    const create = view.getByRole("button", { name: "Create chat" });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.click(selector);
    expect(view.getByRole("option", { name: /\/worktrees\/one/ }).textContent).toContain(
      "feature/one",
    );
    const detached = view.getByRole("option", { name: /\/worktrees\/two/ });
    expect(detached.textContent).toContain("Detached HEAD");
    fireEvent.click(detached);
    expect(selector.textContent).toContain("/worktrees/two");
    expect(create.hasAttribute("disabled")).toBe(false);
    fireEvent.click(create);
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]).toEqual({
      workspaceId: "A",
      runtimeKind: "opencode",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "provider",
        modelId: "model",
        variant: "low",
        profileId: "runtime-profile",
      },
      customAgentRoleId: null,
      location: "existing_worktree",
      existingWorktree: { workingDirectory: "/worktrees/two" },
      manualTitle: "",
      targetBranch: { remote: "origin", branch: "main" },
    });
  } finally {
    view.unmount();
  }
  // This flow renders the create dialog and waits for host reads.
}, 2_500);

test("Existing worktree shows the loading, failed, and empty states, and retries", async () => {
  const reads: Array<{ resolve: (worktrees: string[]) => void; reject: (cause: Error) => void }> =
    [];
  const view = renderCreation(
    async () => {
      throw new Error("Unexpected creation");
    },
    () => {},
    () => {
      throw new Error("Unexpected successful creation");
    },
    {
      workspaceSessionWorktreesList: () =>
        new Promise((resolve, reject) => {
          reads.push({
            resolve: (paths) =>
              resolve({
                worktrees: paths.map((workingDirectory) => ({
                  workingDirectory,
                  branchName: null,
                })),
              }),
            reject,
          });
        }),
    },
  );
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /Existing worktree/ }));
    const selector = view.getByRole("button", { name: "Worktree" });
    expect(selector.textContent).toContain("Loading worktrees…");
    expect(selector.hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(reads).toHaveLength(1), { timeout: 800 });
    await act(async () => reads[0]?.reject(new Error("git worktree list failed")));
    const alert = await view.findByRole("alert", {}, { timeout: 800 });
    expect(alert.textContent).toContain("Could not load worktrees. git worktree list failed");
    expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Retry worktrees" }));
    await waitFor(() => expect(reads).toHaveLength(2), { timeout: 800 });
    await act(async () => reads[1]?.resolve([]));
    await view.findByText(
      "No other worktrees exist for this repository. Use New worktree to create one.",
      {},
      { timeout: 800 },
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(selector.hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(true);
  } finally {
    view.unmount();
  }
  // This flow renders the create dialog and waits for host reads.
}, 2_500);

test("a failed creation reads the worktrees again and marks a removed choice as unavailable", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  let reads = 0;
  const view = renderCreation(
    async (input) => {
      requests.push(input);
      throw new Error("The directory is not a registered worktree of this repository.");
    },
    () => {},
    () => {
      throw new Error("Unexpected successful creation");
    },
    {
      workspaceSessionWorktreesList: async () => {
        reads += 1;
        return {
          worktrees:
            reads === 1 ? [{ workingDirectory: "/worktrees/one", branchName: "feature/one" }] : [],
        };
      },
    },
  );
  try {
    await selectModel(view);
    fireEvent.change(view.getByLabelText("Name optional"), { target: { value: "Kept name" } });
    fireEvent.click(view.getByRole("radio", { name: /Existing worktree/ }));
    const selector = view.getByRole("button", { name: "Worktree" });
    await waitFor(() => expect(selector.hasAttribute("disabled")).toBe(false), { timeout: 800 });
    fireEvent.click(selector);
    fireEvent.click(view.getByRole("option", { name: /\/worktrees\/one/ }));
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    fireEvent.click(await view.findByRole("button", { name: "Edit choices" }));
    await view.findByText(
      "The selected worktree is no longer available. Select another worktree.",
      {},
      { timeout: 800 },
    );
    expect(requests).toHaveLength(1);
    expect(reads).toBe(2);
    expect(
      view.getByText("The directory is not a registered worktree of this repository."),
    ).toBeTruthy();
    expect(view.getByDisplayValue("Kept name")).toBeTruthy();
    expect(selector.textContent).toContain("/worktrees/one");
    expect(
      view.getByRole("radio", { name: /Existing worktree/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(true);
  } finally {
    view.unmount();
  }
  // This flow renders the create dialog and waits for host reads.
}, 2_500);
