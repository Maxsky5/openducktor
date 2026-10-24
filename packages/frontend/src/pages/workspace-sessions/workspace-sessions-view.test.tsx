import { VisibleSessionTargetProvider } from "@/features/session-navigation/visible-session-target";
import { CommandPaletteTestContext } from "@/test-utils/command-palette-test-context";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type {
  TerminalSummary,
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
  WorkspaceSessionCreateInput,
} from "@openducktor/contracts";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, type ReactNode, startTransition, useEffect, useState } from "react";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { installPanelLayout } from "@/test-utils/panel-layout";
import { QueryProvider } from "@/test-utils/query-provider";
import { RIGHT_PANEL_OPEN_STORAGE_KEY } from "@/features/session-panels/use-right-panel-open";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { ThemeProvider } from "@/components/layout/theme-provider";
import type { HostClient } from "@openducktor/host-client";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  RuntimeDefinitionsContext,
  TaskSnapshotContext,
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
import {
  createAgentSessionFixture,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createWorkspacePresenceFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { BrowserRuntimeProvider } from "@/features/browser";
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
import * as createDialog from "./workspace-session-create-dialog";
import { useActiveWorkspace } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";
import { SessionsPage } from "@/pages/sessions/sessions-page";
import { createRuntimeDefinitionsContextValue } from "@/pages/agents/agent-studio-test-utils";
import * as terminalMount from "@/features/terminals/terminal-viewport-mount";

// Every test here renders the full workspace session page, which can exceed 1000 ms on a loaded
// CI runner. Each test sets a 5_000 ms budget for that render.

let chatStub: ReturnType<typeof spyOn<typeof workspaceChat, "WorkspaceSessionChat">>;
// The host storage of the test. Each render of one test reads the same saved selection.
let hostStorage: ClientStorage;
beforeEach(() => {
  chatStub = spyOn(workspaceChat, "WorkspaceSessionChat").mockImplementation(() => <></>);
  hostStorage = createMemoryClientStorage();
});

afterEach(() => {
  chatStub.mockRestore();
  localStorage.removeItem(RIGHT_PANEL_OPEN_STORAGE_KEY);
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

test.each([
  [true, "primary"],
  [false, "menu"],
] as const)(
  "worktree archive confirms removal=%s from the %s action",
  async (removeWorktree, entry) => {
    const worktree = worktreeRecord("Second");
    const requests: unknown[] = [];
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
        return { ...worktree, archivedAt: 2000 };
      },
    };
    const view = renderSessions(hostClient);
    try {
      const trigger = await openArchive(view, "Second", entry);
      expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
      expect(requests).toEqual([]);
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      expect(view.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect(document.activeElement === trigger).toBe(true));
      expect(requests).toEqual([]);
      await openArchive(view, "Second", entry);
      await view.findByText(/This worktree has local changes/, {}, { timeout: 800 });
      await act(async () => {
        view.store.replaceSession(
          createAgentSessionFixture({
            runtimeKind: "opencode",
            externalSessionId: "native-Second",
            workingDirectory: "/worktrees/second",
            sessionAssociation: { kind: "repository" },
            status: "running",
            pendingApprovals: [],
            pendingQuestions: [],
          }),
        );
      });
      expect(
        view.getByText(
          /Archiving stops this chat's terminals, development servers, and its running session/,
        ),
      ).toBeTruthy();
      expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      if (!removeWorktree) fireEvent.click(view.getByRole("switch"));
      const submit = view.getByRole("button", { name: "Archive chat" });
      await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false), { timeout: 800 });
      fireEvent.click(submit);
      await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true), { timeout: 800 });
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
      expect(requests).toEqual([expectedRequest]);
      expect(await view.findByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    } finally {
      view.unmount();
    }
  },
  5_000,
);

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
      "Could not load chats: Workspace database unavailable",
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
      "Could not refresh chats: Workspace database unavailable",
      {},
      { timeout: 1_500 },
    );
    expect(view.getByLabelText("Draft for First")).toHaveProperty("value", "Unsaved draft");
    expect(mounts).toBe(1);

    failReads = false;
    const readsBeforeRetry = reads;
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads).toBe(readsBeforeRetry + 1), { timeout: 1_500 });
    await waitFor(() => expect(view.queryByText(/Could not refresh chats/)).toBeNull(), {
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
    params.delete("creating");
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
    fireEvent.click(view.getByRole("link", { name: "Open " + id.toLowerCase() + " chat" }));
    await view.findByRole("heading", { name: id, level: 2 });
  }
  const trigger = view.getByRole("button", {
    name: entry === "primary" ? "Archive chat" : "Session actions",
  });
  if (entry === "primary") {
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
  }
  fireEvent.click(trigger);
  const menu = await view.findByRole("dialog", { name: "Session actions" });
  const archive = within(menu).getByRole("button", { name: "Archive chat" });
  archive.focus();
  fireEvent.click(archive);
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
  workspaceId = crypto.randomUUID(),
  queryControls: ReactNode = null,
  previewControls: ReactNode = null,
  options: { workspaces?: ActiveWorkspace[]; viaSessionsPage?: boolean } = {},
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
        sessionAssociation: { kind: "repository" },
        status: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    );
  }
  const connection = createTestClientConnection({ client: hostClient, storage: hostStorage });
  const view = render(
    <MemoryRouter initialEntries={Array.isArray(initialEntry) ? initialEntry : [initialEntry]}>
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
  );
  return { ...view, workspaceId, store };
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
    selectWorkspace: async (workspaceId, onSelected) => {
      const next = openWorkspaces.find((entry) => entry.workspaceId === workspaceId);
      if (!next) throw new Error("Workspace is not open.");
      await Promise.resolve();
      startTransition(() => {
        setWorkspace(next);
        onSelected?.();
      });
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
      return { hostInstanceId: "host", terminals: [summary] };
    },
    ...overrides,
  };
}

test.each(["Archive chat", "New chat", "Rename chat", "Session actions"] as const)(
  "%s closes while a workspace route is pending and stays closed on return",
  async (dialogName) => {
    const workspaces = ["A", "B"].map((name) => ({
      workspaceId: crypto.randomUUID(),
      workspaceName: name,
      repoPath: `/${name}`,
    }));
    const first = workspaces[0]!;
    const other = workspaces[1]!;
    const records = dialogName === "New chat" ? [] : [sessionRecord("First")];
    const chatList = Promise.withResolvers<WorkspaceSession[]>();
    const archives: WorkspaceSessionArchiveInput[] = [];
    const creates: WorkspaceSessionCreateInput[] = [];
    const hostClient = createChatTerminalClient(
      async (workspaceId) => (workspaceId === other.workspaceId ? chatList.promise : records),
      {
        workspaceSessionArchive: async (input) => {
          archives.push(input);
          return { ...sessionRecord("First"), archivedAt: 2000 };
        },
        workspaceSessionCreate: async (input) => {
          creates.push(input);
          throw new Error("Unexpected chat creation.");
        },
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
    try {
      const heading = records.length ? "First" : "Workspace chat";
      await view.findByRole("heading", { name: heading });
      if (records.length) {
        await waitFor(() =>
          expect(view.container.querySelector("[data-terminal-viewport]")).not.toBeNull(),
        );
      }
      const viewport = view.container.querySelector("[data-terminal-viewport]");
      const back = view.getByRole("button", { name: "Back" });
      const forward = view.getByRole("button", { name: "Forward" });
      const openDialog = async () => {
        // A view that shows again takes input after its content turns active.
        await waitFor(() =>
          expect(view.getByRole("heading", { name: heading }).closest("[inert]") === null).toBe(
            true,
          ),
        );
        if (dialogName === "Archive chat") {
          await openArchive(view, "First", "primary");
        } else if (dialogName === "New chat") {
          fireEvent.click(view.getByRole("button", { name: "New chat" }));
        } else {
          fireEvent.click(view.getByRole("button", { name: "Session actions" }));
          if (dialogName === "Rename chat") {
            const menu = await view.findByRole("dialog", { name: "Session actions" });
            fireEvent.click(within(menu).getByRole("button", { name: "Rename" }));
          }
        }
        return view.findByRole("dialog", { name: dialogName });
      };
      const dialog = await openDialog();
      fireEvent.click(back);
      await view.findByText("Loading chats…");
      expect(view.getByTestId("session-url").textContent).toBe(otherUrl);
      expect(dialog.isConnected).toBe(false);
      expect(view.queryByRole("dialog")).toBeNull();
      if (viewport) expect(viewport.isConnected).toBe(true);
      expect(archives).toHaveLength(0);
      expect(creates).toHaveLength(0);

      fireEvent.click(forward);
      await view.findByRole("heading", { name: heading });
      expect(view.queryByRole("dialog")).toBeNull();
      if (viewport) expect(view.container.querySelector("[data-terminal-viewport]")).toBe(viewport);

      // A return before the hidden view turns inactive also keeps the dialog closed.
      await openDialog();
      fireEvent.click(back);
      fireEvent.click(forward);
      await view.findByRole("heading", { name: heading });
      expect(view.queryByRole("dialog")).toBeNull();
      expect(archives).toHaveLength(0);
      expect(creates).toHaveLength(0);
    } finally {
      view.unmount();
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
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    await view.findByRole("button", { name: "Archiving…" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.workspaceId).toBe(first.workspaceId);
    fireEvent.click(back);
    await view.findByText("Loading chats…");
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
    expect(view.getByText("Loading chats…")).toBeTruthy();
    expect(requests).toHaveLength(1);
  } finally {
    view.unmount();
    chatList.resolve([]);
    archived.resolve({ ...sessionRecord("First"), archivedAt: 2000 });
  }
}, 5_000);

test.each(["cached", "pending", "cached empty", "pending empty"] as const)(
  "chat terminal viewports survive workspace switches with a %s destination list",
  async (listState) => {
    const pending = listState.startsWith("pending");
    const empty = listState.endsWith("empty");
    const otherSessions = empty ? [] : [sessionRecord("First")];
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
    const view = renderSessions(
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
    );
    try {
      await waitFor(() =>
        expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1),
      );
      fireEvent.contextMenu(view.getByRole("tab", { name: "Shell, Running" }));
      fireEvent.click(await view.findByRole("menuitem", { name: "Move to right panel" }));
      const first = view.container.querySelector("[data-terminal-viewport]");
      const draft = view.getByTestId(`${workspaces[0]!.workspaceId} draft`);
      fireEvent.click(view.getByRole("button", { name: "Open workspace B" }));
      if (pending) {
        await view.findByText("Loading chats…");
        expect(first?.isConnected).toBe(true);
        expect(view.queryByRole("heading", { name: "First", level: 2 })).toBeNull();
        // The hidden view turns inactive after the switch paints.
        await waitFor(() => expect(activeChats.size).toBe(0));
        await act(async () => {
          chatList.resolve(otherSessions);
          await chatList.promise;
        });
      }
      if (empty) await view.findByRole("heading", { name: "Workspace chat" });
      await waitFor(() =>
        expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(
          empty ? 1 : 2,
        ),
      );
      const second = [...view.container.querySelectorAll("[data-terminal-viewport]")].find(
        (node) => node !== first,
      );
      expect(first?.isConnected).toBe(true);
      expect(draft.isConnected).toBe(true);
      await waitFor(() =>
        expect([...activeChats]).toEqual(empty ? [] : [workspaces[1]!.workspaceId]),
      );
      fireEvent.click(view.getByRole("button", { name: "Open workspace A" }));
      await waitFor(() => expect([...activeChats]).toEqual([workspaces[0]!.workspaceId]));
      expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(
        empty ? 1 : 2,
      );
      expect(first?.isConnected).toBe(true);
      if (!empty) expect(second?.isConnected).toBe(true);
      expect(view.getByTestId(`${workspaces[0]!.workspaceId} draft`)).toBe(draft);
    } finally {
      view.unmount();
      navigation.mockRestore();
    }
  },
  5_000,
);

test("chat terminal viewports drop the least recent chat with its pane", async () => {
  // Each xterm adds 790 style rules, and happy-dom checks all of them on each style read.
  const mount = spyOn(terminalMount, "mountTerminalViewport").mockImplementation((input) => {
    input.onHydrated();
    return { activate: () => undefined, dispose: () => undefined };
  });
  const hostClient = createChatTerminalClient();
  chatStub.mockImplementation(({ workspace, record }) => (
    <input data-chat-draft data-testid={`${workspace.workspaceId}:${record.id} draft`} />
  ));
  const workspaces = Array.from({ length: 7 }, (_, index) => ({
    workspaceId: crypto.randomUUID(),
    workspaceName: String(index),
    repoPath: `/repo-${index}`,
  }));
  const view = renderSessions(
    hostClient,
    undefined,
    `/sessions?workspace=${workspaces[0]!.workspaceId}&kind=workspace`,
    workspaces[0]!.workspaceId,
    <SeedChatLists workspaces={workspaces} />,
    null,
    { workspaces, viaSessionsPage: true },
  );
  try {
    const workspaceButtons = view.getAllByRole("button", { name: /^Open workspace \d$/ });
    const waitOptions = {
      container: view.container,
      mutationObserverOptions: { subtree: true, childList: true },
    };
    await waitFor(
      () => expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1),
      waitOptions,
    );
    const first = view.container.querySelector("[data-terminal-viewport]");
    const firstDraft = view.getByTestId(`${workspaces[0]!.workspaceId}:First draft`);
    for (let index = 1; index < 6; index += 1) {
      fireEvent.click(workspaceButtons[index]!);
      await waitFor(
        () =>
          expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(
            index + 1,
          ),
        waitOptions,
      );
    }
    fireEvent.click(workspaceButtons[6]!);
    await waitFor(() => {
      expect(first?.isConnected).toBe(false);
      expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(6);
    }, waitOptions);
    expect(firstDraft.isConnected).toBe(false);
    expect(view.container.querySelectorAll("[data-chat-draft]")).toHaveLength(6);
  } finally {
    view.unmount();
    mount.mockRestore();
  }
}, 5_000);

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
        ? { hostInstanceId: "host", terminals: [] }
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

test("creating a chat keeps the view that opened the dialog", async () => {
  const workspaceId = crypto.randomUUID();
  chatStub.mockImplementation(({ record }) => <input data-testid={`${record.id} draft`} />);
  const dialog = spyOn(createDialog, "WorkspaceSessionCreateDialog").mockImplementation(
    ({ onCreated }) => (
      <button onClick={() => onCreated(sessionRecord("Second"))}>Complete create</button>
    ),
  );
  const view = renderSessions(
    createChatTerminalClient(async () => [sessionRecord("First"), sessionRecord("Second")]),
    undefined,
    `/sessions?workspace=${workspaceId}&kind=workspace&session=First&create=session`,
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
    fireEvent.click(view.getByRole("button", { name: "Complete create" }));
    await view.findByRole("heading", { name: "Second" });
    expect(viewport?.isConnected).toBe(true);
    expect(draft.isConnected).toBe(true);
    fireEvent.click(view.getByRole("link", { name: "Open first chat" }));
    await view.findByRole("heading", { name: "First" });
    expect(view.getByTestId("First draft")).toBe(draft);
    expect(viewport?.isConnected).toBe(true);
  } finally {
    view.unmount();
    dialog.mockRestore();
  }
}, 5_000);

test("a revisited chat becomes the saved selection after reload", async () => {
  const workspaceId = crypto.randomUUID();
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  const client = createChatTerminalClient(async () => [
    sessionRecord("First"),
    sessionRecord("Second"),
  ]);
  const open = (sessionId?: string) =>
    renderSessions(
      client,
      undefined,
      `/sessions?workspace=${workspaceId}&kind=workspace${sessionId ? `&session=${sessionId}` : ""}`,
      workspaceId,
      null,
      null,
      { viaSessionsPage: true },
    );
  let view = open("First");
  try {
    await view.findByRole("heading", { name: "First", level: 2 });
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await view.findByRole("heading", { name: "Second", level: 2 });
    await waitFor(() => expect(hostStorage.getItem(key)).toBe("Second"));
    fireEvent.click(view.getByRole("link", { name: "Open first chat" }));
    await view.findByRole("heading", { name: "First", level: 2 });
    await waitFor(() => expect(hostStorage.getItem(key)).toBe("First"));
    view.unmount();
    view = open();
    await view.findByRole("heading", { name: "First", level: 2 });
  } finally {
    view.unmount();
  }
}, 5_000);

test("a removed chat loses its terminal viewport and pane", async () => {
  const workspaceId = crypto.randomUUID();
  let records = [sessionRecord("First"), sessionRecord("Second")];
  chatStub.mockImplementation(({ record }) => <input data-testid={`${record.id} draft`} />);
  const view = renderSessions(
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
  );
  try {
    await waitFor(() =>
      expect(view.container.querySelectorAll("[data-terminal-viewport]")).toHaveLength(1),
    );
    const first = view.container.querySelector("[data-terminal-viewport]");
    const draft = view.getByTestId("First draft");
    fireEvent.click(view.getByRole("button", { name: "Remove first chat" }));
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
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

test("chats share right panel visibility and keep their own selected tab", async () => {
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(hostClient, undefined, "/chats?session=First");
  try {
    await view.findByRole("button", { name: "Hide right panel" });
    fireEvent.click(view.getByRole("button", { name: "Hide right panel" }));
    expect(view.queryByRole("tablist", { name: "Right panel tabs" })).toBeNull();
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy(),
    );
    expect(view.getByRole("button", { name: "Show right panel" })).toBeTruthy();
    expect(view.queryByRole("tablist", { name: "Right panel tabs" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show right panel" }));
    await view.findByRole("tablist", { name: "Right panel tabs" });
    fireEvent.mouseDown(view.getByRole("tab", { name: "Files" }), { button: 0 });
    fireEvent.mouseUp(view.getByRole("tab", { name: "Files" }), { button: 0 });
    await waitFor(() =>
      expect(view.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true"),
    );
    fireEvent.click(view.getByRole("link", { name: "Open first chat" }));
    await view.findByRole("tablist", { name: "Right panel tabs" });
    expect(view.getByRole("tab", { name: "Diffs" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(() =>
      expect(view.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(localStorage.getItem(RIGHT_PANEL_OPEN_STORAGE_KEY)).toBe("true");
  } finally {
    view.unmount();
  }
}, 5_000);

test("the right panel uses the saved panel choice", async () => {
  localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, "false");
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(hostClient, "First");
  try {
    await view.findByRole("button", { name: "Show right panel" });
    expect(view.queryByRole("tablist", { name: "Right panel tabs" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show right panel" }));
    await view.findByRole("tablist", { name: "Right panel tabs" });
    expect(localStorage.getItem(RIGHT_PANEL_OPEN_STORAGE_KEY)).toBe("true");
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
  const view = renderSessions(
    hostClient,
    undefined,
    "/chats?session=First",
    workspaceId,
    <RemoveFirst />,
  );
  try {
    const draft = await view.findByTestId("visible-draft");
    fireEvent.click(view.getByRole("button", { name: "Open draft" }));
    expect(draft.textContent).toContain("First:draft.ts");
    fireEvent.click(view.getByRole("button", { name: "Edit draft" }));
    expect(draft.textContent).toContain("First:draft.ts");
    fireEvent.click(view.getByRole("button", { name: "Remove first chat" }));
    expect(view.getByTestId("visible-draft").textContent).toContain("First:draft.ts");
    await view.findByRole("button", { name: "Keep editing" });
    expect(view.getByTestId("visible-draft")).toBe(draft);
    expect(draft.textContent).toContain("First:draft.ts");

    fireEvent.click(view.getByRole("button", { name: "Keep editing" }));
    expect(view.queryByRole("button", { name: "Discard draft" })).toBeNull();
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await view.findByRole("button", { name: "Discard draft" });
    fireEvent.click(view.getByRole("button", { name: "Discard draft" }));
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
      expect(view.getByText("This chat is unavailable")).toBeTruthy();
    } finally {
      view.unmount();
      content.mockRestore();
    }
  },
  5_000,
);

test("session selection survives reload and Back/Forward without refetching workspace data", async () => {
  let listReads = 0;
  let settingsReads = 0;
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => {
      listReads += 1;
      return [sessionRecord("First"), sessionRecord("Second")];
    },
    workspaceGetSettingsSnapshot: () => {
      settingsReads += 1;
      return new Promise(() => {});
    },
  };
  let view = renderSessions(hostClient, undefined, "/chats?keep=value");
  try {
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
    await waitFor(
      () =>
        expect(view.getByTestId("session-url").textContent).toBe(
          "/chats?keep=value&session=Second",
        ),
      { timeout: 800 },
    );
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(
      () => expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy(),
      { timeout: 800 },
    );
    fireEvent.click(view.getByRole("button", { name: "Forward" }));
    await waitFor(
      () => expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy(),
      {
        timeout: 800,
      },
    );
    expect(listReads).toBe(1);
    expect(settingsReads).toBe(1);
    const reloadUrl = view.getByTestId("session-url").textContent ?? "";
    view.unmount();
    view = renderSessions(hostClient, undefined, reloadUrl);
    await view.findByRole("heading", { name: "Second", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
  } finally {
    view.unmount();
  }
}, 5_000);

test("switching loaded chats keeps only the selected session header", async () => {
  const chat = spyOn(workspaceChat, "WorkspaceSessionChat").mockImplementation(({ record }) => (
    <div role="region" aria-label="Chat transcript">
      {record.id}
    </div>
  ));
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [
      sessionRecord("First"),
      sessionRecord("Second"),
      sessionRecord("Third"),
    ],
    workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
  };
  const view = renderSessions(hostClient, undefined, "/chats?session=First");
  try {
    await view.findByRole("region", { name: "Chat transcript" }, { timeout: 3_000 });
    expect(view.getAllByRole("heading", { level: 2 }).map((header) => header.textContent)).toEqual([
      "First",
    ]);
    for (const selected of ["Second", "Third", "First", "Second", "Third"]) {
      fireEvent.click(view.getByRole("link", { name: `Open ${selected.toLowerCase()} chat` }));
      await waitFor(
        () =>
          expect(view.getByRole("region", { name: "Chat transcript" }).textContent).toBe(selected),
        { timeout: 3_000 },
      );
      expect(
        view.getAllByRole("heading", { level: 2 }).map((header) => header.textContent),
      ).toEqual([selected]);
      expect(view.getAllByRole("button", { name: "Session actions" })).toHaveLength(1);
    }
    const back = view.getByRole("button", { name: "Back" });
    fireEvent.click(view.getByRole("button", { name: "Session actions" }));
    fireEvent.click(await view.findByRole("button", { name: "Rename" }, { timeout: 800 }));
    await view.findByRole("dialog", { name: "Rename chat" }, { timeout: 800 });
    fireEvent.click(back);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull(), { timeout: 800 });
    expect(view.getAllByRole("heading", { level: 2 }).map((header) => header.textContent)).toEqual([
      "Second",
    ]);
    expect(view.getByRole("region", { name: "Chat transcript" }).textContent).toBe("Second");
  } finally {
    view.unmount();
    chat.mockRestore();
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
    await view.findByText("Loading chats…", {}, { timeout: 800 });
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

test("restores the last session on a bare session URL and keeps workspace preferences separate", async () => {
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  let view = renderSessions(hostClient);
  const workspaceA = view.workspaceId;
  try {
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    fireEvent.click(view.getByRole("link", { name: "Open chats" }));
    await waitFor(
      () => expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Second"),
      { timeout: 800 },
    );
    view.unmount();
    expect(hostStorage.getItem(workspaceSessionSelectionStorageKey(workspaceA))).toBe("Second");

    view = renderSessions(hostClient);
    const workspaceB = view.workspaceId;
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    view.unmount();
    expect(hostStorage.getItem(workspaceSessionSelectionStorageKey(workspaceB))).toBe("First");

    view = renderSessions(hostClient, undefined, "/chats", workspaceA);
    await view.findByRole("heading", { name: "Second", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
    view.unmount();

    view = renderSessions(hostClient, undefined, "/chats?session=First", workspaceA);
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
  } finally {
    view.unmount();
  }
}, 5_000);

test("does not erase the saved session while the list loads and preserves unrelated query params", async () => {
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
    await view.findByText("Loading chats…", {}, { timeout: 800 });
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
  const view = renderSessions(hostClient, undefined, "/chats?session=Missing&keep=value");
  try {
    await view.findByText("This chat is unavailable", {}, { timeout: 800 });
    expect(view.queryByRole("heading", { name: "First", level: 2 })).toBeNull();
    expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Missing&keep=value");
    fireEvent.click(view.getByRole("link", { name: "Open first chat" }));
    await waitFor(
      () =>
        expect(view.getByTestId("session-url").textContent).toBe("/chats?session=First&keep=value"),
      { timeout: 800 },
    );
    await openArchive(view, "First");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    });
    await view.findByText("No active sessions.", {}, { timeout: 800 });
    await waitFor(
      () => expect(view.getByTestId("session-url").textContent).toBe("/chats?keep=value"),
      { timeout: 800 },
    );
  } finally {
    view.unmount();
  }
}, 5_000);

test("an activity link selects its chat while the page is already open", async () => {
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
  };
  const view = renderSessions(hostClient);
  try {
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(
      () => expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy(),
      {
        timeout: 800,
      },
    );
    fireEvent.click(view.getByRole("link", { name: "Open first chat" }));
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(
      () => expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy(),
      {
        timeout: 800,
      },
    );
  } finally {
    view.unmount();
  }
}, 5_000);

test("a worktree archive keeps confirmation pending until the host succeeds", async () => {
  const worktree = worktreeRecord("Second");
  const requests: WorkspaceSessionArchiveInput[] = [];
  let complete!: (record: WorkspaceSession) => void;
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
    workspaceSessionArchive: (input) => {
      requests.push(input);
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  };
  const view = renderSessions(hostClient);
  try {
    await openArchive(view, "Second");
    expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Session actions", hidden: true })).toBeTruthy();
    const submit = view.getByRole("button", { name: "Archive chat" });
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false), { timeout: 800 });
    fireEvent.click(submit);
    await waitFor(() => expect(requests.length === 1).toBe(true), { timeout: 800 });
    expect(requests).toEqual([
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
    expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Archiving…" }).hasAttribute("disabled")).toBe(true);
    expect(
      view.getByRole("button", { name: "Session actions", hidden: true }).hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => {
      complete({ ...worktree, archivedAt: 2000 });
    });
    await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true), { timeout: 800 });
    await waitFor(
      () => expect(view.queryByRole("heading", { name: "Second", level: 2 }) === null).toBe(true),
      {
        timeout: 800,
      },
    );
  } finally {
    view.unmount();
  }
}, 5_000);

test("a failed direct archive does not show its error in the next worktree dialog", async () => {
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
  const view = renderSessions(hostClient);
  try {
    await openArchive(view, "First");
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    await view.findByText("Stop failed: runtime disconnected", {}, { timeout: 800 });
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await openArchive(view, "Second");
    expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
    expect(requests).toEqual([
      {
        workspaceId: view.workspaceId,
        sessionId: "First",
        confirmStop: true,
        removeWorktree: false,
      },
    ]);
    const submit = view.getByRole("button", { name: "Archive chat" });
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false), { timeout: 800 });
    fireEvent.click(submit);
    await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true), { timeout: 800 });
    await waitFor(
      () => expect(view.queryByRole("heading", { name: "Second", level: 2 }) === null).toBe(true),
      {
        timeout: 800,
      },
    );
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

test("running archive needs confirmation and keeps the session when Stop fails", async () => {
  const requests: WorkspaceSessionArchiveInput[] = [];
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
    workspaceSessionArchive: async (input) => {
      requests.push(input);
      throw new Error("Stop failed: runtime disconnected");
    },
  };
  const view = renderSessions(hostClient, "Second");
  try {
    await openArchive(view, "Second");
    expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
    expect(requests).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    await view.findByText("Stop failed: runtime disconnected", {}, { timeout: 800 });
    expect(view.getByRole("button", { name: "Archive chat" }).hasAttribute("disabled")).toBe(false);
    expect(requests).toEqual([
      {
        workspaceId: view.workspaceId,
        sessionId: "Second",
        confirmStop: true,
        removeWorktree: false,
      },
    ]);
    expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
    expect(view.getByRole("heading", { name: "Second", level: 2, hidden: true })).toBeTruthy();
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
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
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
      fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
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
);

test("an archive in flight disables repeat actions until the host succeeds", async () => {
  let complete!: (record: WorkspaceSession) => void;
  let calls = 0;
  const hostClient: Partial<HostClient> = {
    workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
    workspaceGetSettingsSnapshot: () => new Promise(() => {}),
    workspaceSessionArchive: () => {
      calls += 1;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  };
  const view = renderSessions(hostClient);
  try {
    await openArchive(view, "Second");
    expect(calls).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Archive chat" }));
    const pending = await view.findByRole("button", { name: "Archiving…" });
    expect(pending.hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(
      view.getByRole("button", { name: "Session actions", hidden: true }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(pending);
    expect(calls).toBe(1);
    await act(async () => complete({ ...sessionRecord("Second"), archivedAt: 2000 }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    expect(view.getByRole("button", { name: "Session actions" }).hasAttribute("disabled")).toBe(
      false,
    );
  } finally {
    view.unmount();
  }
}, 5_000);
