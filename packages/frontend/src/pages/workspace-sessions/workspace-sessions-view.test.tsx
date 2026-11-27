import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
import { createAnimationFrameTestDriver } from "@openducktor/frontend-core/test-support/animation-frame-test-driver";
import {
  useVisibleWorkspaceDraftId,
  VisibleSessionTargetProvider,
} from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { CommandPaletteTestContext } from "@/test-utils/command-palette-test-context";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type {
  TerminalSummary,
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
} from "@openducktor/contracts";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { type QueryClient, notifyManager, useQueryClient } from "@tanstack/react-query";
import {
  act,
  type ReactNode,
  StrictMode,
  startTransition,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { installPanelLayout } from "@/test-utils/panel-layout";
import { QueryProvider } from "@/test-utils/query-provider";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { ThemeProvider } from "@/components/layout/theme-provider";
import type { HostClient } from "@openducktor/host-client";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  RuntimeDefinitionsContext,
  TaskSnapshotContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  WorkspaceBranchStateContext,
  WorkspacePresenceContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import {
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  HostRuntimeStatusContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import {
  createAgentSessionFixture,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createWorkspacePresenceFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { BrowserRuntimeProvider } from "@/features/browser";
import type { SessionPanelOwner } from "@/features/session-panels";
import { createSessionPanelLayoutStore } from "@/features/session-panels/session-panel-layout-store";
import WorkspaceSessionsPage from "./workspace-sessions-page";
import { useWorkspaceSessionPreview } from "./use-workspace-session-preview";
import { workspaceSessionSelectionStorageKey } from "./use-workspace-session-selection";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionListQueryOptions,
} from "@openducktor/frontend-core/queries/workspace-sessions";
import * as workspaceChat from "./workspace-session-chat";
import * as sessionContent from "./workspace-session-content";
import * as workspaceNavigation from "./use-workspace-session-navigation";
import * as draftView from "./workspace-session-draft-view";
import { useActiveWorkspace } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";
import { SessionsPage } from "@/pages/sessions/sessions-page";
import { createRuntimeDefinitionsContextValue } from "@openducktor/frontend-core/test-support/runtime-hook-harness";
import * as terminalMount from "@/features/terminals/terminal-viewport-mount";

// Every test here renders the full workspace session page, which can exceed 1000 ms on a loaded
// CI runner. Each test sets a 5_000 ms budget for that render.

let chatStub: ReturnType<typeof spyOn<typeof workspaceChat, "WorkspaceSessionChat">>;
let viewportStub: ReturnType<typeof spyOn<typeof terminalMount, "mountTerminalViewport">>;
// The host storage of the test. Each render of one test reads the same saved selection.
let hostStorage: ClientStorage;
beforeEach(() => {
  chatStub = spyOn(workspaceChat, "WorkspaceSessionChat").mockImplementation(() => <></>);
  // The page tests check viewport placement and retention. The terminal layer tests cover output.
  viewportStub = spyOn(terminalMount, "mountTerminalViewport").mockImplementation((input) => {
    input.onHydrated();
    return { activate: () => undefined, setShown: () => undefined, dispose: () => undefined };
  });
  hostStorage = createMemoryClientStorage();
});

afterEach(() => {
  chatStub.mockRestore();
  viewportStub.mockRestore();
});

const sessionRecord = (id: string): WorkspaceSession => ({
  id,
  runtimeKind: "opencode",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: id,
  targetBranch: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

const worktreeRecord = (id: string): WorkspaceSession => ({
  ...sessionRecord(id),
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: `/worktrees/${id.toLowerCase()}`,
    branchName: `feature/${id.toLowerCase()}`,
    worktreeState: "present",
  },
});

describe("Worktree archive actions", () => {
  setupTestingLibraryFakeTimers();

  test.each([
    { entry: "primary", removeWorktree: true },
    { entry: "menu", removeWorktree: false },
  ] as const)(
    "worktree archive from $entry waits for the host with removal=$removeWorktree",
    async ({ entry, removeWorktree }) => {
      const worktree = worktreeRecord("Second");
      const requests: WorkspaceSessionArchiveInput[] = [];
      const archived = { ...worktree, archivedAt: 2000 };
      const completion = Promise.withResolvers<WorkspaceSession>();
      const hostClient: Partial<HostClient> = {
        workspaceSessionListActive: async () => [sessionRecord("First"), worktree],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchivePreview: async () => ({
          branchName: "feature/second",
          worktreeExists: true,
          hasUncommittedChanges: true,
          sharedWith: [],
          taskOwners: [],
        }),
        workspaceSessionArchive: async (input) => {
          requests.push(input);
          return completion.promise;
        },
      };
      const view = renderSessions(hostClient);
      try {
        const trigger = await openArchive(view, "Second", entry);
        const firstDialog = view.getByRole("dialog", { name: "Archive session" });
        fireEvent.click(await within(firstDialog).findByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(document.activeElement === trigger).toBe(true));
        expect(firstDialog.isConnected).toBe(false);
        expect(requests).toEqual([]);

        await openArchive(view, "Second", entry);
        const dialog = within(view.getByRole("dialog", { name: "Archive session" }));
        const removal = await dialog.findByRole("switch", { name: "Remove worktree and branch" });
        expect(removal.getAttribute("aria-checked")).toBe("true");
        if (!removeWorktree) fireEvent.click(removal);
        const submit = dialog.getByRole<HTMLButtonElement>("button", { name: "Archive session" });
        await waitFor(() => expect(submit.disabled).toBe(false), { timeout: 800 });
        fireEvent.click(submit);
        const expectedRequest: WorkspaceSessionArchiveInput = {
          workspaceId: view.workspaceId,
          sessionId: "Second",
          confirmStop: true,
          removeWorktree,
        };
        if (removeWorktree)
          expectedRequest.worktreeConfirmation = {
            workingDirectory: "/worktrees/second",
            branchName: "feature/second",
          };
        await waitFor(() => expect(requests).toEqual([expectedRequest]), { timeout: 800 });
        const pending = within(view.getByRole("dialog", { name: "Archive session" }));
        expect(pending.getByRole("button", { name: "Archiving…" })).toHaveProperty(
          "disabled",
          true,
        );
        expect(trigger).toHaveProperty("disabled", true);

        await act(async () => completion.resolve(archived));
        await view.findByRole("heading", { name: "First", level: 2 });
        expect(view.queryByRole("dialog", { name: "Archive session" })).toBeNull();
        expect(view.getByRole("button", { name: "Session actions" })).toHaveProperty(
          "disabled",
          false,
        );
      } finally {
        view.unmount();
        completion.resolve(archived);
      }
    },
    5_000,
  );
});

test("a durable-list failure is an error rather than an empty Workspace and Retry reloads it", async () => {
  let reads = 0;
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => {
      reads += 1;
      if (reads === 1) throw new Error("Workspace database unavailable");
      return [];
    },
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(hostClient);
  try {
    await view.findByText(
      "Could not load sessions: Workspace database unavailable",
      {},
      { timeout: 800 },
    );
    expect(view.queryByText("No active sessions.") === null).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await view.findByText("No active sessions.", {}, { timeout: 800 });
    expect(reads).toBe(2);
  } finally {
    view.unmount();
  }
}, 5_000);

// A full chat view render with Query reads and a retry needs more than the default wait.
test("a failed chat-list refresh keeps the selected chat and its draft mounted", async () => {
  let mounts = 0;
  const chat = spyOn(workspaceChat, "WorkspaceSessionChat").mockImplementation(({ record }) => {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      mounts += 1;
    }, []);
    return (
      <input
        aria-label={`Draft for ${record.id}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  });
  let failReads = false;
  let reads = 0;
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => {
      reads += 1;
      if (failReads) throw new Error("Workspace database unavailable");
      return [sessionRecord("First")];
    },
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
  };
  const workspaceId = crypto.randomUUID();
  function RefetchChats() {
    const client = useQueryClient();
    return (
      <button
        type="button"
        onClick={() =>
          void client.refetchQueries({
            queryKey: workspaceSessionQueryKeys.list(workspaceId, false),
          })
        }
      >
        Refetch chats
      </button>
    );
  }
  const view = renderSessions(
    hostClient,
    undefined,
    "/chats?session=First",
    workspaceId,
    <RefetchChats />,
  );
  try {
    const draft = await view.findByLabelText("Draft for First", {}, { timeout: 3_000 });
    fireEvent.change(draft, { target: { value: "Unsaved draft" } });
    failReads = true;
    fireEvent.click(view.getByRole("button", { name: "Refetch chats" }));

    await view.findByText(
      "Could not refresh sessions: Workspace database unavailable",
      {},
      { timeout: 1_500 },
    );
    expect(view.getByLabelText("Draft for First")).toHaveProperty("value", "Unsaved draft");
    expect(mounts).toBe(1);

    failReads = false;
    const readsBeforeRetry = reads;
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads).toBe(readsBeforeRetry + 1), { timeout: 1_500 });
    await waitFor(() => expect(view.queryByText(/Could not refresh sessions/)).toBeNull(), {
      timeout: 1_500,
    });
    expect(view.getByLabelText("Draft for First")).toHaveProperty("value", "Unsaved draft");
  } finally {
    view.unmount();
    chat.mockRestore();
  }
}, 8_000);

function SessionLinks() {
  const location = useLocation();
  const href = (sessionId: string | null) => {
    const params = new URLSearchParams(location.search);
    if (sessionId) params.set("session", sessionId);
    else params.delete("session");
    return location.pathname + (params.size ? "?" + params.toString() : "");
  };
  return (
    <>
      {["First", "Second", "Third"].map((id) => (
        <Link key={id} to={href(id)}>
          Open {id.toLowerCase()} chat
        </Link>
      ))}
      <Link to={href(null)}>Open chats</Link>
    </>
  );
}

async function openArchive(
  view: ReturnType<typeof renderSessions>,
  id: string,
  entry: "primary" | "menu" = "menu",
) {
  if (!view.queryByRole("heading", { name: id, level: 2 })) {
    await act(async () => {
      fireEvent.click(view.getByRole("link", { name: "Open " + id.toLowerCase() + " chat" }));
    });
    await view.findByRole("heading", { name: id, level: 2 });
  }
  const trigger = view.getByRole("button", {
    name: entry === "primary" ? "Archive session" : "Session actions",
  });
  if (entry === "primary") {
    await act(async () => {
      trigger.focus();
      fireEvent.click(trigger);
    });
    return trigger;
  }
  await act(async () => fireEvent.click(trigger));
  const menu = await view.findByRole("dialog", { name: "Session actions" });
  const archive = within(menu).getByRole("button", { name: "Archive session" });
  await act(async () => {
    archive.focus();
    fireEvent.click(archive);
  });
  return trigger;
}

function RouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="session-url">{location.pathname + location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Forward
      </button>
    </>
  );
}

function SessionMetadataControls({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          updateWorkspaceSessionQueries(client, workspaceId, {
            ...sessionRecord("Draft"),
            externalSessionId: null,
            createdAt: 2000,
            updatedAt: 2000,
          })
        }
      >
        Add draft fixture
      </button>
      <button
        type="button"
        onClick={() =>
          updateWorkspaceSessionQueries(client, workspaceId, {
            ...sessionRecord("First"),
            updatedAt: 3000,
          })
        }
      >
        Update first fixture
      </button>
      <button
        type="button"
        onClick={() =>
          updateWorkspaceSessionQueries(client, workspaceId, {
            ...sessionRecord("Draft"),
            createdAt: 2000,
            updatedAt: 4000,
          })
        }
      >
        Start draft fixture
      </button>
    </>
  );
}

test("metadata updates and new drafts keep the selected conversation", async () => {
  const workspaceId = crypto.randomUUID();
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(
    hostClient,
    undefined,
    "/chats?session=Second",
    workspaceId,
    <SessionMetadataControls workspaceId={workspaceId} />,
  );
  try {
    await view.findByRole("heading", { name: "Second", level: 2 });
    for (const action of ["Add draft fixture", "Update first fixture", "Start draft fixture"]) {
      fireEvent.click(view.getByRole("button", { name: action }));
      await act(async () => {});
      expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
      expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Second");
    }
  } finally {
    view.unmount();
  }
}, 5_000);

function renderSessions(
  hostClient: Partial<HostClient>,
  runningId?: string,
  initialEntry: string | string[] = "/chats",
  workspaceId: string = crypto.randomUUID(),
  queryControls: ReactNode = null,
  previewControls: ReactNode = null,
  options: { workspaces?: ActiveWorkspace[]; viaSessionsPage?: boolean; strictMode?: boolean } = {},
) {
  const workspace = options.workspaces?.find((entry) => entry.workspaceId === workspaceId) ?? {
    workspaceId,
    workspaceName: "A",
    repoPath: "/repo",
  };
  const store = createAgentSessionsStore("/repo");
  if (runningId) {
    store.replaceSession(
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: `native-${runningId}`,
        workingDirectory: "/repo",
        sessionAssociation: { kind: "repository", workspaceId: "workspace-1" },
        status: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    );
  }
  const connection = createTestClientConnection({ client: hostClient, storage: hostStorage });
  const view = render(
    <MemoryRouter
      initialEntries={Array.isArray(initialEntry) ? initialEntry : [initialEntry]}
      useTransitions={false}
    >
      <RouteControls />
      <SessionLinks />
      <QueryProvider connection={connection}>
        <ThemeProvider>
          {queryControls}
          <TestWorkspaceScope initial={workspace} workspaces={options.workspaces}>
            <AgentSessionReadModelStateContext
              value={{
                sessionReadModelLoadState: { kind: "ready", workspaceRepoPath: "/repo" },
                getSessionFault: () => null,
                workspaceSessionRecordsError: null,
                reloadSessionReadModel: () => {},
              }}
            >
              <AgentSessionsContext value={store}>
                <WorkspaceBranchStateContext.Provider
                  value={{
                    activeWorkspace: null,
                    branches: [],
                    activeBranch: { name: "main", detached: false },
                    isLoadingBranches: false,
                    isSwitchingBranch: false,
                    branchSyncDegraded: false,
                    switchBranch: async () => {},
                  }}
                >
                  <WorkspacePreviewTransitionGuardProvider>
                    <VisibleSessionTargetProvider>
                      <SettingsModalProvider>
                        <CommandPaletteTestContext>
                          <BrowserRuntimeProvider>
                            {options.viaSessionsPage ? (
                              <SessionsPage />
                            ) : (
                              <ActiveWorkspaceSessions />
                            )}
                          </BrowserRuntimeProvider>
                        </CommandPaletteTestContext>
                        {previewControls}
                      </SettingsModalProvider>
                    </VisibleSessionTargetProvider>
                  </WorkspacePreviewTransitionGuardProvider>
                </WorkspaceBranchStateContext.Provider>
              </AgentSessionsContext>
            </AgentSessionReadModelStateContext>
          </TestWorkspaceScope>
        </ThemeProvider>
      </QueryProvider>
    </MemoryRouter>,
    options.strictMode ? { wrapper: StrictMode } : undefined,
  );
  return { ...view, workspaceId, queryClient: connection.queryClient };
}

async function renderLoadedSessionRoute(
  reads: Pick<HostClient, "workspaceSessionListActive" | "workspaceGetSettingsSnapshot">,
  url = "/chats",
  workspaceId?: string,
) {
  const view = renderSessions(reads, undefined, url, workspaceId);
  await act(async () => {
    await Promise.all([
      view.queryClient.ensureQueryData(workspaceSessionListQueryOptions(view.workspaceId)),
      view.queryClient.ensureQueryData(settingsSnapshotQueryOptions()),
    ]);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  return view;
}

function TestWorkspaceScope({
  initial,
  workspaces = [],
  children,
}: {
  initial: ActiveWorkspace;
  workspaces?: ActiveWorkspace[] | undefined;
  children: ReactNode;
}) {
  const [workspace, setWorkspace] = useState<ActiveWorkspace | null>(initial);
  const openWorkspaces = workspaces.length ? workspaces : [initial];
  const records = openWorkspaces.map((entry) => createWorkspaceRecordFixture(entry));
  const state = createWorkspaceStateFixture({
    activeWorkspace: records.find((entry) => entry.workspaceId === workspace?.workspaceId) ?? null,
    workspaces: records,
    selectWorkspace: async (workspaceId, onSelected, options) => {
      const next = openWorkspaces.find((entry) => entry.workspaceId === workspaceId);
      if (!next) throw new Error("Workspace is not open.");
      await Promise.resolve();
      const apply = () => {
        setWorkspace(next);
        onSelected?.();
      };
      if (options?.immediate) apply();
      else startTransition(apply);
    },
  });
  return (
    <ActiveWorkspaceContext
      value={{ activeWorkspace: workspace, setActiveWorkspace: setWorkspace }}
    >
      <WorkspacePresenceContext value={createWorkspacePresenceFixture()}>
        <WorkspaceStateContext value={state}>
          <TaskSnapshotContext value={{ tasks: [], isLoadingTasks: false }}>
            <RuntimeDefinitionsContext
              value={createRuntimeDefinitionsContextValue({ runtimeDefinitions: [] })}
            >
              <HostRuntimeStatusContext value={createHostRuntimeStatusContextValue()}>
                {workspaces.map((entry) => (
                  <button key={entry.workspaceId} onClick={() => setWorkspace(entry)}>
                    Open workspace {entry.workspaceName}
                  </button>
                ))}
                {children}
              </HostRuntimeStatusContext>
            </RuntimeDefinitionsContext>
          </TaskSnapshotContext>
        </WorkspaceStateContext>
      </WorkspacePresenceContext>
    </ActiveWorkspaceContext>
  );
}

function ActiveWorkspaceSessions() {
  const workspace = useActiveWorkspace();
  return workspace ? <WorkspaceSessionsPage workspace={workspace} isWorkspaceReady /> : null;
}

function createChatTerminalClient(
  listActive: HostClient["workspaceSessionListActive"] = async () => [sessionRecord("First")],
  overrides: Partial<HostClient> = {},
): Partial<HostClient> {
  return {
    systemGetPlatform: async () => "darwin",
    workspaceSessionListActive: listActive,
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    terminalList: async ({ filter }) => {
      if (filter.kind !== "workspace_session") throw new Error("Expected a chat terminal filter.");
      const summary: TerminalSummary = {
        terminalId: `${filter.workspaceId}:${filter.sessionId}`,
        label: "Shell",
        context: { ...filter, repoPath: "/repo" },
        initialWorkingDir: "/repo",
        createdAt: "2026-10-18T00:00:00.000Z",
        lifecycle: "running",
        exit: null,
        startedBy: "user",
      };
      return { hostInstanceId: "host", revision: 1, terminals: [summary] };
    },
    ...overrides,
  };
}

test.each(["Archive session", "Rename session", "Session actions"] as const)(
  "%s closes while a workspace route is pending and stays closed on return",
  async (dialogName) => {
    chatStub.mockImplementation(() => <input aria-label="Chat draft" />);
    const workspaces = ["A", "B"].map((name) => ({
      workspaceId: crypto.randomUUID(),
      workspaceName: name,
      repoPath: `/${name}`,
    }));
    const first = workspaces[0]!;
    const other = workspaces[1]!;
    const records = [sessionRecord("First")];
    const chatList = Promise.withResolvers<WorkspaceSession[]>();
    const archives: WorkspaceSessionArchiveInput[] = [];
    const hostClient = createChatTerminalClient(
      async (workspaceId) => (workspaceId === other.workspaceId ? chatList.promise : records),
      {
        workspaceSessionArchive: async (input) => {
          archives.push(input);
          return { ...sessionRecord("First"), archivedAt: 2000 };
        },
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
      },
    );
    const firstUrl = `/sessions?workspace=${first.workspaceId}&kind=workspace${records.length ? "&session=First" : ""}`;
    const otherUrl = `/sessions?workspace=${other.workspaceId}&kind=workspace&session=Other`;
    const view = renderSessions(
      hostClient,
      undefined,
      [otherUrl, firstUrl],
      first.workspaceId,
      null,
      null,
      {
        workspaces,
        viaSessionsPage: true,
      },
    );
    const frames = createAnimationFrameTestDriver();
    frames.install();
    try {
      const heading = records.length ? "First" : "Workspace session";
      await view.findByRole("heading", { name: heading });
      const draft = records.length ? await view.findByLabelText("Chat draft") : null;
      const back = view.getByRole("button", { name: "Back" });
      const forward = view.getByRole("button", { name: "Forward" });
      const openDialog = async () => {
        if (dialogName === "Archive session") {
          await openArchive(view, "First", "primary");
        } else {
          fireEvent.click(view.getByRole("button", { name: "Session actions" }));
          if (dialogName === "Rename session") {
            const menu = await view.findByRole("dialog", { name: "Session actions" });
            fireEvent.click(within(menu).getByRole("button", { name: "Rename" }));
          }
        }
        return view.findByRole("dialog", { name: dialogName });
      };
      const dialog = await openDialog();
      await act(async () => fireEvent.click(back));
      await view.findByText("Loading sessions…");
      expect(view.getByTestId("session-url").textContent).toBe(otherUrl);
      expect(dialog.isConnected).toBe(false);
      expect(view.queryAllByRole("dialog").length).toBe(0);
      if (draft) expect(draft.isConnected).toBe(true);
      expect(archives).toHaveLength(0);

      await frames.flushFrames();
      await act(async () => fireEvent.click(forward));
      await frames.flushFrames();
      expect(view.queryAllByRole("dialog").length).toBe(0);
      await view.findByRole("heading", { name: heading });
      if (draft) expect(view.getByLabelText("Chat draft") === draft).toBe(true);

      if (dialogName === "Archive session") {
        // The archive target belongs to the kept Workspace view. It also clears before paint.
        await openDialog();
        await act(async () => fireEvent.click(back));
        expect(view.getByTestId("session-url").textContent).toBe(otherUrl);
        await act(async () => fireEvent.click(forward));
        await frames.flushFrames();
        expect(view.queryAllByRole("dialog").length).toBe(0);
        await view.findByRole("heading", { name: heading });
        expect(archives).toHaveLength(0);
      }
    } finally {
      view.unmount();
      frames.restore();
      chatList.resolve([]);
    }
  },
  5_000,
);

test("an archive started before Back updates its workspace while the next workspace is pending", async () => {
  const first = { workspaceId: crypto.randomUUID(), workspaceName: "A", repoPath: "/A" };
  const other = { workspaceId: crypto.randomUUID(), workspaceName: "B", repoPath: "/B" };
  const workspaces = [first, other];
  const chatList = Promise.withResolvers<WorkspaceSession[]>();
  const archived = Promise.withResolvers<WorkspaceSession>();
  const requests: WorkspaceSessionArchiveInput[] = [];
  let cache: QueryClient | null = null;
  function CaptureCache() {
    cache = useQueryClient();
    return null;
  }
  const hostClient = createChatTerminalClient(
    async (workspaceId) =>
      workspaceId === other.workspaceId ? chatList.promise : [sessionRecord("First")],
    {
      workspaceSessionArchive: async (input) => {
        requests.push(input);
        return archived.promise;
      },
    },
  );
  const otherUrl = `/sessions?workspace=${other.workspaceId}&kind=workspace&session=Other`;
  const view = renderSessions(
    hostClient,
    undefined,
    [otherUrl, `/sessions?workspace=${first.workspaceId}&kind=workspace&session=First`],
    first.workspaceId,
    <CaptureCache />,
    null,
    { workspaces, viaSessionsPage: true },
  );
  try {
    await view.findByRole("heading", { name: "First" });
    const back = view.getByRole("button", { name: "Back" });
    await openArchive(view, "First", "primary");
    expect(requests).toHaveLength(0);
    fireEvent.click(await view.findByRole("button", { name: "Archive session" }));
    const pending = await view.findByRole("button", { name: "Archiving…" });
    expect(pending.hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(
      view.getByRole("button", { name: "Session actions", hidden: true }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(pending);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.workspaceId).toBe(first.workspaceId);
    fireEvent.click(back);
    await view.findByText("Loading sessions…");
    expect(view.queryByRole("dialog")).toBeNull();
    await act(async () => {
      archived.resolve({ ...sessionRecord("First"), archivedAt: 2000 });
      await archived.promise;
    });
    await waitFor(() =>
      expect(
        cache?.getQueryData<WorkspaceSession[]>(
          workspaceSessionQueryKeys.list(first.workspaceId, false),
        ),
      ).toEqual([]),
    );
    expect(view.getByTestId("session-url").textContent).toBe(otherUrl);
    expect(view.getByText("Loading sessions…")).toBeTruthy();
    expect(requests).toHaveLength(1);
  } finally {
    view.unmount();
    chatList.resolve([]);
    archived.resolve({ ...sessionRecord("First"), archivedAt: 2000 });
  }
}, 5_000);

test.each([
  { destination: "a cached chat", pending: false },
  { destination: "a pending list that resolves empty", pending: true },
])(
  "chat terminals and drafts survive a switch to $destination",
  async ({ pending }) => {
    const otherSessions = pending ? [] : [sessionRecord("First")];
    const viewportCount = pending ? 1 : 2;
    const activeChats = new Set<string>();
    chatStub.mockImplementation(({ workspace, isActive }) => {
      useEffect(() => {
        if (!isActive) return;
        activeChats.add(workspace.workspaceId);
        return () => {
          activeChats.delete(workspace.workspaceId);
        };
      }, [isActive, workspace.workspaceId]);
      return <input data-chat-draft data-testid={`${workspace.workspaceId} draft`} />;
    });
    const workspaces = ["A", "B"].map((name) => ({
      workspaceId: crypto.randomUUID(),
      workspaceName: name,
      repoPath: `/${name}`,
    }));
    const useNavigation = workspaceNavigation.useWorkspaceSessionNavigation;
    const navigation = spyOn(
      workspaceNavigation,
      "useWorkspaceSessionNavigation",
    ).mockImplementation((args) =>
      useNavigation({
        ...args,
        setSearchParams: (next, options) => {
          // A user can leave after the view mounts but before this router write commits.
          if (args.workspaceId !== workspaces[1]!.workspaceId) args.setSearchParams(next, options);
        },
      }),
    );
    const chatList = Promise.withResolvers<WorkspaceSession[]>();
    const hostClient = createChatTerminalClient(async (workspaceId) =>
      workspaceId === workspaces[1]!.workspaceId
        ? pending
          ? chatList.promise
          : otherSessions
        : [sessionRecord("First")],
    );
    const view = await act(async () =>
      renderSessions(
        hostClient,
        undefined,
        `/sessions?workspace=${workspaces[0]!.workspaceId}&kind=workspace&session=First`,
        workspaces[0]!.workspaceId,
        <>
          <SeedChatLists workspaces={workspaces.slice(0, 1)} />
          {!pending && <SeedChatLists workspaces={workspaces.slice(1)} sessions={otherSessions} />}
        </>,
        null,
        { workspaces, viaSessionsPage: true },
      ),
    );
    const frames = createAnimationFrameTestDriver();
    frames.install();
    try {
      await waitFor(() =>
        expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1),
      );
      await act(async () =>
        fireEvent.contextMenu(view.getByRole("tab", { name: "Shell, Running" })),
      );
      const move = await view.findByRole("menuitem", { name: "Move to right panel" });
      await act(async () => fireEvent.click(move));
      const first = view.container.querySelector("[data-terminal-viewport]");
      const draft = view.getByTestId(`${workspaces[0]!.workspaceId} draft`);
      await act(async () =>
        fireEvent.click(view.getByRole("button", { name: "Open workspace B" })),
      );
      if (pending) {
        await view.findByText("Loading sessions…");
        expect(first?.isConnected).toBe(true);
        expect(view.queryByRole("heading", { name: "First", level: 2 })).toBeNull();
        // The hidden view turns inactive after the switch paints.
        await frames.flushFrames();
        expect(activeChats.size).toBe(0);
        await act(async () => {
          chatList.resolve(otherSessions);
          await chatList.promise;
          await new Promise<void>((resolve) => notifyManager.schedule(resolve));
        });
        expect(view.getByRole("heading", { name: "Workspace session" })).toBeTruthy();
      }
      await waitFor(() =>
        expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(
          viewportCount,
        ),
      );
      const second = [...view.container.querySelectorAll("[data-terminal-viewport]")].find(
        (node) => node !== first,
      );
      expect(first?.isConnected).toBe(true);
      expect(draft.isConnected).toBe(true);
      await frames.flushFrames();
      expect([...activeChats]).toEqual(pending ? [] : [workspaces[1]!.workspaceId]);
      await act(async () =>
        fireEvent.click(view.getByRole("button", { name: "Open workspace A" })),
      );
      await frames.flushFrames();
      expect([...activeChats]).toEqual([workspaces[0]!.workspaceId]);
      expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(
        viewportCount,
      );
      expect(first?.isConnected).toBe(true);
      if (!pending) expect(second?.isConnected).toBe(true);
      expect(view.getByTestId(`${workspaces[0]!.workspaceId} draft`)).toBe(draft);
    } finally {
      view.unmount();
      frames.restore();
      navigation.mockRestore();
    }
  },
  5_000,
);

test.each([true, false])(
  "a chat switch keeps the layout when the next chat has terminals=%s",
  async (hasTerminals) => {
    const media = spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    }));
    const workspaceId = crypto.randomUUID();
    chatStub.mockImplementation(({ record }) => <input data-testid={`${record.id} draft`} />);
    const client = createChatTerminalClient(async () => [
      sessionRecord("First"),
      sessionRecord("Second"),
    ]);
    const listTerminals = client.terminalList!;
    client.terminalList = async (input) =>
      !hasTerminals &&
      input.filter.kind === "workspace_session" &&
      input.filter.sessionId === "Second"
        ? { hostInstanceId: "host", revision: 1, terminals: [] }
        : listTerminals(input);
    // The resizable group takes a size change only when its panels have a size, as in a browser.
    const removePanelLayout = installPanelLayout();
    const view = renderSessions(
      client,
      undefined,
      `/sessions?workspace=${workspaceId}&kind=workspace&session=First`,
      workspaceId,
      null,
      null,
      { viaSessionsPage: true },
    );
    try {
      const draft = await view.findByTestId("First draft");
      await waitFor(() =>
        expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1),
      );
      const viewport = view.container.querySelector("[data-terminal-viewport]");
      await act(async () => {
        fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
      });
      await view.findByRole("heading", { name: "Second" });
      await waitFor(() => {
        const split = view
          .getByTestId("Second draft")
          .closest('[data-group][id^="workspace-session-terminal-layout"]');
        const panels = split!.querySelectorAll<HTMLElement>(":scope > [data-panel]");
        expect(panels).toHaveLength(2);
        expect(panels[0]!.style.flexGrow).toBe(hasTerminals ? "72" : "100");
        expect(panels[1]!.style.flexGrow).toBe(hasTerminals ? "28" : "0");
      });
      expect(viewport?.isConnected).toBe(true);
      expect(draft.isConnected).toBe(true);
      await act(async () => {
        fireEvent.click(view.getByRole("link", { name: "Open first chat" }));
      });
      await view.findByRole("heading", { name: "First" });
      expect(view.getByTestId("First draft")).toBe(draft);
      expect(viewport?.isConnected).toBe(true);
      expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(
        hasTerminals ? 2 : 1,
      );
    } finally {
      view.unmount();
      removePanelLayout();
      media.mockRestore();
    }
  },
  5_000,
);

test("a removed chat loses its terminal viewport and pane", async () => {
  const workspaceId = crypto.randomUUID();
  let records = [sessionRecord("First"), sessionRecord("Second")];
  chatStub.mockImplementation(({ record }) => <input data-testid={`${record.id} draft`} />);
  const view = await act(async () =>
    renderSessions(
      createChatTerminalClient(async () => records),
      undefined,
      `/sessions?workspace=${workspaceId}&kind=workspace`,
      workspaceId,
      <RemoveChat
        workspaceId={workspaceId}
        onRemove={() => {
          records = [sessionRecord("Second")];
        }}
      />,
      null,
      { viaSessionsPage: true },
    ),
  );
  try {
    await waitFor(() =>
      expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1),
    );
    const first = view.container.querySelector("[data-terminal-viewport]");
    const draft = view.getByTestId("First draft");
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Remove first chat" })));
    await act(async () => fireEvent.click(view.getByRole("link", { name: "Open second chat" })));
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy(),
    );
    expect(first?.isConnected).toBe(false);
    expect(draft.isConnected).toBe(false);
    await waitFor(() =>
      expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1),
    );
  } finally {
    view.unmount();
  }
}, 5_000);

function RemoveChat({ workspaceId, onRemove }: { workspaceId: string; onRemove: () => void }) {
  const client = useQueryClient();
  return (
    <button
      onClick={() => {
        onRemove();
        client.setQueryData(workspaceSessionQueryKeys.list(workspaceId, false), [
          sessionRecord("Second"),
        ]);
      }}
    >
      Remove first chat
    </button>
  );
}

function SeedChatLists({
  workspaces,
  sessions,
}: {
  workspaces: ActiveWorkspace[];
  sessions?: WorkspaceSession[];
}) {
  const client = useQueryClient();
  useEffect(() => {
    for (const workspace of workspaces)
      client.setQueryData(
        workspaceSessionQueryKeys.list(workspace.workspaceId, false),
        sessions ?? [sessionRecord("First")],
      );
  }, [client, sessions, workspaces]);
  return null;
}

function DirtyPreview({ startOpen = true }: { startOpen?: boolean }) {
  const draft = {
    rootPath: "/repo",
    relativePath: "draft.ts",
  };
  const [file, setFile] = useState<{ rootPath: string; relativePath: string } | null>(
    startOpen ? draft : null,
  );
  const { preview, onDiscard } = useWorkspaceSessionPreview(file, setFile, false);
  return (
    <>
      <output data-testid="draft">{preview.model.selectedFile?.relativePath ?? "none"}</output>
      <button
        onClick={() => {
          preview.onSelectFile(draft);
          setFile(draft);
        }}
      >
        Open draft
      </button>
      <button onClick={() => preview.model.onLeavePolicyChange("confirm")}>Edit draft</button>
      <Dialog open={preview.model.hasPendingDiscard}>
        <DialogContent>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>Confirm that you want to discard the changes.</DialogDescription>
          <button
            disabled={preview.model.isApplyingTransition}
            onClick={preview.model.onKeepEditing}
          >
            Keep editing
          </button>
          <button disabled={preview.model.isApplyingTransition} onClick={onDiscard}>
            Discard draft
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

test("each chat keeps its own right panel state and selected tab", async () => {
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = await act(async () => renderSessions(hostClient, undefined, "/chats?session=First"));
  const openChat = async (name: "first" | "second", heading: string) => {
    await act(async () => fireEvent.click(view.getByRole("link", { name: `Open ${name} chat` })));
    await waitFor(() =>
      expect(view.getByRole("heading", { name: heading, level: 2 })).toBeTruthy(),
    );
  };
  try {
    await view.findByRole("button", { name: "Hide right panel" });
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Hide right panel" })));
    expect(view.queryByRole("tablist", { name: "Right panel tabs" })).toBeNull();
    await openChat("second", "Second");
    await view.findByRole("tablist", { name: "Right panel tabs" });
    await act(async () =>
      fireEvent.mouseDown(view.getByRole("tab", { name: "Files" }), { button: 0 }),
    );
    await act(async () =>
      fireEvent.mouseUp(view.getByRole("tab", { name: "Files" }), { button: 0 }),
    );
    await waitFor(() =>
      expect(view.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true"),
    );
    await openChat("first", "First");
    expect(view.getByRole("button", { name: "Show right panel" })).toBeTruthy();
    expect(view.queryByRole("tablist", { name: "Right panel tabs" })).toBeNull();
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Show right panel" })));
    await view.findByRole("tablist", { name: "Right panel tabs" });
    expect(view.getByRole("tab", { name: "Diffs" }).getAttribute("aria-selected")).toBe("true");
    await openChat("second", "Second");
    await waitFor(() =>
      expect(view.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true"),
    );
  } finally {
    view.unmount();
  }
}, 5_000);

test("the right panel uses the saved state of the chat", async () => {
  const workspaceId = crypto.randomUUID();
  const owner: SessionPanelOwner = { kind: "chat", workspaceId, sessionId: "First" };
  createSessionPanelLayoutStore(hostStorage).setRightOpen(owner, false);
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(hostClient, "First", "/chats", workspaceId);
  try {
    await view.findByRole("button", { name: "Show right panel" });
    expect(view.queryByRole("tablist", { name: "Right panel tabs" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show right panel" }));
    await view.findByRole("tablist", { name: "Right panel tabs" });
    expect(createSessionPanelLayoutStore(hostStorage).readPanels(owner).right).toBe(true);
  } finally {
    view.unmount();
  }
}, 5_000);

test("an externally removed chat keeps its draft until the user leaves", async () => {
  const workspaceId = crypto.randomUUID();
  function RemoveFirst() {
    const queryClient = useQueryClient();
    return (
      <button
        onClick={() =>
          queryClient.setQueryData(workspaceSessionListQueryOptions(workspaceId).queryKey, [
            sessionRecord("Second"),
          ])
        }
      >
        Remove first chat
      </button>
    );
  }
  const content = spyOn(sessionContent, "WorkspaceSessionContent").mockImplementation(
    function SessionContent({ record }) {
      const [file, setFile] = useState<{ rootPath: string; relativePath: string } | null>(null);
      const { preview, onDiscard } = useWorkspaceSessionPreview(file, setFile, false);
      return (
        <div data-testid="visible-draft">
          {record.id}:{preview.model.selectedFile?.relativePath ?? "none"}
          {record.id === "First" ? (
            <button
              onClick={() => {
                const draft = { rootPath: "/repo", relativePath: "draft.ts" };
                preview.onSelectFile(draft);
                setFile(draft);
              }}
            >
              Open draft
            </button>
          ) : null}
          <button onClick={() => preview.model.onLeavePolicyChange("confirm")}>Edit draft</button>
          {preview.model.hasPendingDiscard ? (
            <>
              <button onClick={preview.model.onKeepEditing}>Keep editing</button>
              <button onClick={onDiscard}>Discard draft</button>
            </>
          ) : null}
        </div>
      );
    },
  );
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = await act(async () =>
    renderSessions(hostClient, undefined, "/chats?session=First", workspaceId, <RemoveFirst />),
  );
  try {
    const draft = await view.findByTestId("visible-draft");
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Open draft" })));
    expect(draft.textContent).toContain("First:draft.ts");
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Edit draft" })));
    expect(draft.textContent).toContain("First:draft.ts");
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Remove first chat" })));
    expect(view.getByTestId("visible-draft").textContent).toContain("First:draft.ts");
    await view.findByRole("button", { name: "Keep editing" });
    expect(view.getByTestId("visible-draft")).toBe(draft);
    expect(draft.textContent).toContain("First:draft.ts");

    await act(async () => fireEvent.click(view.getByRole("button", { name: "Keep editing" })));
    expect(view.queryByRole("button", { name: "Discard draft" })).toBeNull();
    await act(async () => fireEvent.click(view.getByRole("link", { name: "Open second chat" })));
    await view.findByRole("button", { name: "Discard draft" });
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Discard draft" })));
    await waitFor(() =>
      expect(view.getByTestId("visible-draft").textContent).toContain("Second:none"),
    );
  } finally {
    view.unmount();
    content.mockRestore();
  }
}, 5_000);

test.each(["clean", "close"])(
  "the last removed chat shows as unavailable after its draft is %s",
  async (finish) => {
    const workspaceId = crypto.randomUUID();
    function RemoveLast() {
      const queryClient = useQueryClient();
      return (
        <button
          onClick={() =>
            queryClient.setQueryData(workspaceSessionListQueryOptions(workspaceId).queryKey, [])
          }
        >
          Remove last chat
        </button>
      );
    }
    const content = spyOn(sessionContent, "WorkspaceSessionContent").mockImplementation(
      function SessionContent({ record, onSafeToLeave }) {
        const [file, setFile] = useState<{ rootPath: string; relativePath: string } | null>(null);
        const [canLeave, setCanLeave] = useState(true);
        const { preview, onDiscard } = useWorkspaceSessionPreview(file, setFile, false);
        useEffect(() => {
          if (canLeave || preview.model.selectedFile === null) onSafeToLeave?.();
        }, [canLeave, onSafeToLeave, preview.model.selectedFile]);
        return (
          <div data-testid="visible-draft">
            {record.id}:{preview.model.selectedFile?.relativePath ?? "none"}
            <button
              onClick={() => {
                const draft = { rootPath: "/repo", relativePath: "draft.ts" };
                preview.onSelectFile(draft);
                setFile(draft);
              }}
            >
              Open draft
            </button>
            <button
              onClick={() => {
                preview.model.onLeavePolicyChange("confirm");
                setCanLeave(false);
              }}
            >
              Edit draft
            </button>
            <button
              onClick={() => {
                preview.model.onLeavePolicyChange("allow");
                setCanLeave(true);
              }}
            >
              Make draft clean
            </button>
            <button onClick={preview.model.onClose}>Close draft</button>
            {preview.model.hasPendingDiscard ? (
              <>
                <button onClick={preview.model.onKeepEditing}>Keep editing</button>
                <button onClick={onDiscard}>Discard draft</button>
              </>
            ) : null}
          </div>
        );
      },
    );
    const hostClient: Partial<HostClient> = {
      workspaceSessionListActive: async () => [sessionRecord("First")],
      workspaceGetSettingsSnapshot: () => new Promise(() => {}),
    };
    const view = renderSessions(
      hostClient,
      undefined,
      "/chats?session=First",
      workspaceId,
      <RemoveLast />,
    );
    try {
      await view.findByTestId("visible-draft");
      fireEvent.click(view.getByRole("button", { name: "Open draft" }));
      fireEvent.click(view.getByRole("button", { name: "Edit draft" }));
      fireEvent.click(view.getByRole("button", { name: "Remove last chat" }));
      await view.findByRole("button", { name: "Keep editing" });
      fireEvent.click(view.getByRole("button", { name: "Keep editing" }));
      expect(view.getByTestId("visible-draft").textContent).toContain("First:draft.ts");

      if (finish === "clean") {
        fireEvent.click(view.getByRole("button", { name: "Make draft clean" }));
      } else {
        fireEvent.click(view.getByRole("button", { name: "Close draft" }));
        fireEvent.click(await view.findByRole("button", { name: "Discard draft" }));
      }
      await waitFor(() => expect(view.queryByTestId("visible-draft")).toBeNull());
      expect(view.getByText("This session is unavailable")).toBeTruthy();
    } finally {
      view.unmount();
      content.mockRestore();
    }
  },
  5_000,
);

test("session selection survives reload and Back/Forward without refetching workspace data", async () => {
  chatStub.mockImplementation(({ record }) => (
    <div role="region" aria-label="Chat transcript">
      {record.id}
    </div>
  ));
  let listReads = 0;
  let settingsReads = 0;
  const reads = {
    workspaceSessionListActive: async () => {
      listReads += 1;
      return [sessionRecord("First"), sessionRecord("Second")];
    },
    workspaceGetSettingsSnapshot: async () => {
      settingsReads += 1;
      return createSettingsSnapshotFixture({ theme: "dark" });
    },
  };
  let view = await renderLoadedSessionRoute(reads, "/chats?keep=value");
  try {
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await act(async () => fireEvent.click(view.getByRole("link", { name: "Open second chat" })));
    const reloadUrl = "/chats?keep=value&session=Second";
    expect(view.getByTestId("session-url").textContent).toBe(reloadUrl);
    expect(
      view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["Second"]);
    expect(view.getByRole("region", { name: "Chat transcript" }).textContent).toBe("Second");
    const back = view.getByRole("button", { name: "Back" });
    fireEvent.click(view.getByRole("button", { name: "Session actions" }));
    fireEvent.click(view.getByRole("button", { name: "Rename" }));
    const rename = view.getByRole("dialog", { name: "Rename session" });
    await act(async () => fireEvent.click(back));
    expect(rename.isConnected).toBe(false);
    expect(
      view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["First"]);
    expect(view.getByRole("region", { name: "Chat transcript" }).textContent).toBe("First");
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Forward" })));
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
    expect(view.getByTestId("session-url").textContent).toBe(reloadUrl);
    expect(listReads).toBe(1);
    expect(settingsReads).toBe(1);
    view.unmount();
    view = await renderLoadedSessionRoute(reads, reloadUrl);
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
  } finally {
    view.unmount();
  }
}, 5_000);

test("keeps an explicit session URL while the initial list is pending", async () => {
  let resolveList!: (records: WorkspaceSession[]) => void;
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: () =>
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(hostClient, undefined, "/chats?session=Second");
  try {
    await view.findByText("Loading sessions…", {}, { timeout: 800 });
    expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Second");
    await act(async () => {
      resolveList([sessionRecord("First"), sessionRecord("Second")]);
    });
    await view.findByRole("heading", { name: "Second", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
    expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Second");
  } finally {
    view.unmount();
  }
}, 5_000);

test("a bare URL restores the saved chat after loading, and an explicit link overrides it", async () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  hostStorage.setItem(key, "Second");
  const list = Promise.withResolvers<WorkspaceSession[]>();
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: () => list.promise,
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(hostClient, undefined, "/chats?keep=value", workspaceId);
  try {
    await view.findByText("Loading sessions…", {}, { timeout: 800 });
    expect(hostStorage.getItem(key)).toBe("Second");
    expect(view.getByTestId("session-url").textContent).toBe("/chats?keep=value");
    await act(async () => list.resolve([sessionRecord("First"), sessionRecord("Second")]));
    await waitFor(
      () =>
        expect(view.getByTestId("session-url").textContent).toBe(
          "/chats?keep=value&session=Second",
        ),
      { timeout: 800 },
    );
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();

    await act(async () => fireEvent.click(view.getByRole("link", { name: "Open first chat" })));
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    expect(view.getByTestId("session-url").textContent).toBe("/chats?keep=value&session=First");

    await act(async () => fireEvent.click(view.getByRole("link", { name: "Open chats" })));
    await waitFor(
      () =>
        expect(view.getByTestId("session-url").textContent).toBe("/chats?keep=value&session=First"),
      { timeout: 800 },
    );
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
  } finally {
    view.unmount();
  }
}, 5_000);

test("keeps a missing session URL as unavailable and clears it after the final archive", async () => {
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
    workspaceSessionArchive: async () => ({ ...sessionRecord("First"), archivedAt: 2000 }),
  };
  const view = await act(async () =>
    renderSessions(hostClient, undefined, "/chats?session=Missing&keep=value"),
  );
  try {
    await view.findByText("This session is unavailable", {}, { timeout: 800 });
    expect(view.queryByRole("heading", { name: "First", level: 2 })).toBeNull();
    expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Missing&keep=value");
    await act(async () => fireEvent.click(view.getByRole("link", { name: "Open first chat" })));
    await waitFor(
      () =>
        expect(view.getByTestId("session-url").textContent).toBe("/chats?session=First&keep=value"),
      { timeout: 800 },
    );
    await openArchive(view, "First");
    const archive = await view.findByRole("button", { name: "Archive session" });
    await act(async () => fireEvent.click(archive));
    await view.findByText("No active sessions.", {}, { timeout: 800 });
    await waitFor(
      () => expect(view.getByTestId("session-url").textContent).toBe("/chats?keep=value"),
      { timeout: 800 },
    );
  } finally {
    view.unmount();
  }
}, 5_000);

describe("Archive commands", () => {
  setupTestingLibraryFakeTimers();

  test("a failed Stop keeps the chat and clears its error before the next archive", async () => {
    const worktree = worktreeRecord("Second");
    const requests: WorkspaceSessionArchiveInput[] = [];
    const hostClient: Partial<HostClient> = {
      workspaceSessionListActive: async () => [sessionRecord("First"), worktree],
      workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      workspaceSessionArchivePreview: async () => ({
        branchName: "feature/second",
        worktreeExists: true,
        hasUncommittedChanges: false,
        sharedWith: [],
        taskOwners: [],
      }),
      workspaceSessionArchive: async (input) => {
        requests.push(input);
        if (input.sessionId === "First") throw new Error("Stop failed: runtime disconnected");
        return { ...worktree, archivedAt: 2000 };
      },
    };
    const view = renderSessions(hostClient, "First");
    try {
      await openArchive(view, "First");
      const firstDialog = within(view.getByRole("dialog", { name: "Archive session" }));
      const firstSubmit = firstDialog.getByRole<HTMLButtonElement>("button", {
        name: "Archive session",
      });
      expect(requests).toHaveLength(0);
      await act(async () => fireEvent.click(firstSubmit));
      await firstDialog.findByText("Stop failed: runtime disconnected", {}, { timeout: 800 });
      expect(firstSubmit.disabled).toBe(false);
      expect(view.getByRole("heading", { name: "First", level: 2, hidden: true })).toBeTruthy();
      await act(async () => fireEvent.click(firstDialog.getByRole("button", { name: "Cancel" })));
      await openArchive(view, "Second");
      const secondDialog = within(view.getByRole("dialog", { name: "Archive session" }));
      expect(secondDialog.queryByRole("alert")).toBeNull();
      expect(requests).toEqual([
        {
          workspaceId: view.workspaceId,
          sessionId: "First",
          confirmStop: true,
          removeWorktree: false,
        },
      ]);
      const submit = await secondDialog.findByRole<HTMLButtonElement>("button", {
        name: "Archive session",
      });
      await waitFor(() => expect(submit.disabled).toBe(false), { timeout: 800 });
      await act(async () => fireEvent.click(submit));
      await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
      expect(view.queryByRole("dialog", { name: "Archive session" })).toBeNull();
      expect(requests).toEqual([
        {
          workspaceId: view.workspaceId,
          sessionId: "First",
          confirmStop: true,
          removeWorktree: false,
        },
        {
          workspaceId: view.workspaceId,
          sessionId: "Second",
          confirmStop: true,
          removeWorktree: true,
          worktreeConfirmation: {
            workingDirectory: "/worktrees/second",
            branchName: "feature/second",
          },
        },
      ]);
    } finally {
      view.unmount();
    }
  }, 5_000);

  test("failed selected-chat archive keeps the dirty draft", async () => {
    let rejectArchive!: (reason: Error) => void;
    const hostClient: Partial<HostClient> = {
      workspaceSessionListActive: async () => [sessionRecord("First")],
      workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      workspaceSessionArchive: () =>
        new Promise((_resolve, reject) => {
          rejectArchive = reject;
        }),
    };
    const view = renderSessions(
      hostClient,
      undefined,
      "/chats?session=First",
      crypto.randomUUID(),
      null,
      <DirtyPreview />,
    );
    try {
      await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
      fireEvent.click(view.getByRole("button", { name: "Edit draft" }));
      await openArchive(view, "First");
      fireEvent.click(await view.findByRole("button", { name: "Archive session" }));
      expect(view.getByTestId("draft").textContent).toBe("draft.ts");
      fireEvent.click(view.getByRole("button", { name: "Discard draft" }));
      await waitFor(() => expect(rejectArchive).toBeDefined());
      expect(view.getByTestId("draft").textContent).toBe("draft.ts");
      await act(async () => rejectArchive(new Error("Archive failed")));
      await view.findByText("Archive failed", {}, { timeout: 800 });
      expect(view.getByTestId("draft").textContent).toBe("draft.ts");
    } finally {
      view.unmount();
    }
  }, 5_000);

  test.each([true, false])(
    "a successful archive leaves the previewed chat when another chat exists=%s",
    async (hasNextChat) => {
      const first = sessionRecord("First");
      const archiveDone = Promise.withResolvers<WorkspaceSession>();
      const content = spyOn(sessionContent, "WorkspaceSessionContent").mockImplementation(
        function SessionContent({ record }) {
          return (
            <div data-testid="visible-chat">
              {record.id}
              <DirtyPreview startOpen={false} />
            </div>
          );
        },
      );
      const hostClient: Partial<HostClient> = {
        workspaceSessionListActive: async () =>
          hasNextChat ? [first, sessionRecord("Second")] : [first],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: () => archiveDone.promise,
      };
      const view = renderSessions(hostClient, undefined, "/chats?session=First");
      try {
        const heading = await view.findByRole(
          "heading",
          { name: "First", level: 2 },
          { timeout: 800 },
        );
        expect(heading.closest("[data-panel]") === null).toBe(true);
        fireEvent.click(view.getByRole("button", { name: "Open draft" }));
        fireEvent.click(view.getByRole("button", { name: "Edit draft" }));
        expect(view.getByTestId("draft").textContent).toBe("draft.ts");
        await openArchive(view, "First");
        fireEvent.click(await view.findByRole("button", { name: "Archive session" }));
        expect(view.getByTestId("draft").textContent).toBe("draft.ts");
        fireEvent.click(view.getByRole("button", { name: "Discard draft" }));
        expect(view.getByRole("heading", { name: "First", level: 2, hidden: true })).toBeTruthy();
        expect(view.getByTestId("draft").textContent).toBe("draft.ts");

        archiveDone.resolve({ ...first, archivedAt: 2000 });
        if (hasNextChat) {
          await waitFor(
            () => expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy(),
            { timeout: 800 },
          );
          expect(view.getByTestId("visible-chat").textContent).toContain("Second");
        } else {
          await view.findByText("No active sessions.", {}, { timeout: 800 });
          expect(view.queryByRole("tabpanel", { name: /First/ })).toBeNull();
        }
        await waitFor(
          () => {
            const url = new URL(
              view.getByTestId("session-url").textContent ?? "",
              "http://localhost",
            );
            expect(url.searchParams.get("session")).toBe(hasNextChat ? "Second" : null);
          },
          { timeout: 800 },
        );
      } finally {
        view.unmount();
        content.mockRestore();
      }
    },
    // Full page render flow through the archive dialog, like the other archive tests.
    5_000,
  );
});

test("late save callback from an earlier draft does not redirect away from the currently open draft", async () => {
  const workspaceId = crypto.randomUUID();
  const capturedCallbacks = new Map<
    string,
    (record: WorkspaceSession, attemptId: string, savedDraftId: string) => boolean | void
  >();
  const draftStub = spyOn(draftView, "WorkspaceSessionDraftView").mockImplementation(
    ({ draft, onSavedRecord }) => {
      capturedCallbacks.set(draft.id, onSavedRecord);
      return <div data-testid="active-draft">{draft.id}</div>;
    },
  );
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [],
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
  };
  let draftAId = "";
  let draftBId = "";
  function DraftSwitcher() {
    const navigate = useNavigate();
    const { drafts } = useClientConnection();
    return (
      <button
        type="button"
        onClick={() => {
          const first = drafts.newWorkspaceSessions.createDraft(workspaceId);
          drafts.newWorkspaceSessions.updateComposer(first.id, {
            segments: [{ id: "t1", kind: "text", text: "Draft A" }],
            attachments: [],
          });
          const second = drafts.newWorkspaceSessions.createDraft(workspaceId);
          drafts.newWorkspaceSessions.updateComposer(second.id, {
            segments: [{ id: "t2", kind: "text", text: "Draft B" }],
            attachments: [],
          });
          draftAId = first.id;
          draftBId = second.id;
          navigate(`/chats?draft=${first.id}`);
        }}
      >
        Open draft A
      </button>
    );
  }
  function OpenDraftBButton() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(`/chats?draft=${draftBId}`)}>
        Open draft B
      </button>
    );
  }
  const view = renderSessions(
    hostClient,
    undefined,
    "/chats",
    workspaceId,
    <>
      <DraftSwitcher />
      <OpenDraftBButton />
    </>,
  );
  try {
    fireEvent.click(view.getByRole("button", { name: "Open draft A" }));
    await waitFor(() => expect(view.getByTestId("active-draft").textContent).toBe(draftAId));
    const draftACallback = capturedCallbacks.get(draftAId);
    expect(draftACallback).toBeDefined();

    fireEvent.click(view.getByRole("button", { name: "Open draft B" }));
    await waitFor(() => expect(view.getByTestId("active-draft").textContent).toBe(draftBId));

    let handedOff: boolean | undefined;
    await act(async () => {
      handedOff = draftACallback?.(sessionRecord("SavedFromA"), "attempt-a", draftAId) ?? undefined;
    });
    expect(handedOff).toBe(false);
    expect(view.getByTestId("active-draft").textContent).toBe(draftBId);
    expect(view.getByTestId("session-url").textContent).toBe(`/chats?draft=${draftBId}`);
  } finally {
    view.unmount();
    draftStub.mockRestore();
  }
}, 5_000);

test("unbound workspace session with a tracked startup attempt does not auto-fire workspaceSessionStart", async () => {
  const workspaceId = crypto.randomUUID();
  const unbound: WorkspaceSession = {
    ...sessionRecord("UnboundSession"),
    externalSessionId: null,
  };
  let startCalls = 0;
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [unbound],
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    workspaceSessionStart: async () => {
      startCalls += 1;
      throw new Error("Should not auto-start while tracked startup attempt owns launch");
    },
  };
  function SeedTrackedAttempt() {
    const { startupAttempts } = useClientConnection();
    useLayoutEffect(() => {
      const attemptId = startupAttempts.begin({
        origin: {
          workspaceId,
          repoPath: "/repo",
          scope: { kind: "workspace", draftId: "draft-active" },
        },
        label: "Start workspace session",
        presentation: "inline",
      });
      startupAttempts.setSaved(attemptId, {
        state: "saved",
        target: { kind: "workspace", record: unbound },
      });
      return () => {
        startupAttempts.release(attemptId);
      };
    }, [startupAttempts]);
    return null;
  }
  const view = renderSessions(
    hostClient,
    undefined,
    `/chats?session=${unbound.id}`,
    workspaceId,
    <SeedTrackedAttempt />,
  );
  try {
    await view.findByRole("heading", { name: "UnboundSession" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(startCalls).toBe(0);
  } finally {
    view.unmount();
  }
}, 5_000);

test("StrictMode initial mount keeps an untouched draft alive without creating replacement drafts", async () => {
  const workspaceId = crypto.randomUUID();
  const draftStub = spyOn(draftView, "WorkspaceSessionDraftView").mockImplementation(
    ({ draft }) => <div data-testid="strict-draft">{draft.id}</div>,
  );
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [],
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
  };
  let initialDraftId = "";
  const draftStores: ReturnType<typeof useClientConnection>["drafts"]["newWorkspaceSessions"][] =
    [];
  function OpenUntouchedDraft() {
    const navigate = useNavigate();
    const { drafts } = useClientConnection();
    useEffect(() => {
      draftStores.push(drafts.newWorkspaceSessions);
    }, [drafts.newWorkspaceSessions]);
    return (
      <button
        type="button"
        onClick={() => {
          const created = drafts.newWorkspaceSessions.createDraft(workspaceId);
          initialDraftId = created.id;
          navigate(`/sessions?workspace=${workspaceId}&kind=workspace&draft=${created.id}`);
        }}
      >
        Open untouched draft
      </button>
    );
  }
  const view = renderSessions(
    hostClient,
    undefined,
    `/sessions?workspace=${workspaceId}&kind=workspace`,
    workspaceId,
    <OpenUntouchedDraft />,
    null,
    { viaSessionsPage: true, strictMode: true },
  );
  try {
    fireEvent.click(view.getByRole("button", { name: "Open untouched draft" }));
    await waitFor(() => expect(view.getByTestId("strict-draft").textContent).toBe(initialDraftId));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(view.getByTestId("session-url").textContent).toBe(
      `/sessions?workspace=${workspaceId}&kind=workspace&draft=${initialDraftId}`,
    );
    const activeDraftStore = draftStores.at(-1);
    expect(activeDraftStore?.getDraft(initialDraftId)?.lifecycle).toBe("untouched");
    expect(activeDraftStore?.getSnapshot().map((entry) => entry.id)).toEqual([initialDraftId]);
  } finally {
    view.unmount();
    draftStub.mockRestore();
  }
}, 5_000);

test("switching workspace from a draft keeps the draft view mounted and visible draft continuous", async () => {
  const alpha = { workspaceId: crypto.randomUUID(), workspaceName: "Alpha", repoPath: "/alpha" };
  const beta = { workspaceId: crypto.randomUUID(), workspaceName: "Beta", repoPath: "/beta" };
  let mountCount = 0;
  let unmountCount = 0;
  const draftStub = spyOn(draftView, "WorkspaceSessionDraftView").mockImplementation(
    ({ workspace, draft, onSwitchWorkspace }) => {
      useEffect(() => {
        mountCount += 1;
        return () => {
          unmountCount += 1;
        };
      }, []);
      return (
        <div>
          <div data-testid="draft-workspace">{`${workspace.workspaceId}:${draft.workspaceId}:${draft.id}`}</div>
          <button type="button" onClick={() => onSwitchWorkspace?.(beta.workspaceId)}>
            Switch draft to Beta
          </button>
        </div>
      );
    },
  );
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [],
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
  };
  let draftId = "";
  const seenVisibleDraftIds: (string | null)[] = [];
  function DraftSwitchHarness() {
    const navigate = useNavigate();
    const { drafts } = useClientConnection();
    const visibleDraftId = useVisibleWorkspaceDraftId();
    useEffect(() => {
      if (draftId) seenVisibleDraftIds.push(visibleDraftId);
    }, [visibleDraftId]);
    return (
      <button
        type="button"
        onClick={() => {
          const created = drafts.newWorkspaceSessions.createDraft(alpha.workspaceId);
          draftId = created.id;
          navigate(`/sessions?workspace=${alpha.workspaceId}&kind=workspace&draft=${created.id}`);
        }}
      >
        Open alpha draft
      </button>
    );
  }
  const view = renderSessions(
    hostClient,
    undefined,
    `/sessions?workspace=${alpha.workspaceId}&kind=workspace`,
    alpha.workspaceId,
    null,
    <DraftSwitchHarness />,
    { viaSessionsPage: true, workspaces: [alpha, beta] },
  );
  try {
    fireEvent.click(view.getByRole("button", { name: "Open alpha draft" }));
    await waitFor(() =>
      expect(view.getByTestId("draft-workspace").textContent).toBe(
        `${alpha.workspaceId}:${alpha.workspaceId}:${draftId}`,
      ),
    );
    await waitFor(() => expect(seenVisibleDraftIds).toContain(draftId));
    const draftNodeBefore = view.getByTestId("draft-workspace");
    seenVisibleDraftIds.length = 0;

    fireEvent.click(view.getByRole("button", { name: "Switch draft to Beta" }));
    await waitFor(() =>
      expect(view.getByTestId("draft-workspace").textContent).toBe(
        `${beta.workspaceId}:${beta.workspaceId}:${draftId}`,
      ),
    );

    expect(view.getByTestId("draft-workspace")).toBe(draftNodeBefore);
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    expect(seenVisibleDraftIds.every((id) => id === draftId)).toBe(true);
    expect(view.getByTestId("session-url").textContent).toBe(
      `/sessions?workspace=${beta.workspaceId}&kind=workspace&draft=${draftId}`,
    );
  } finally {
    view.unmount();
    draftStub.mockRestore();
  }
}, 5_000);
