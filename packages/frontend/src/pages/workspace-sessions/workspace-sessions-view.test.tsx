import { VisibleSessionTargetProvider } from "@/features/session-navigation/visible-session-target";
import { afterEach, expect, spyOn, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionArchiveInput } from "@openducktor/contracts";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { act, type ReactNode, useEffect, useState } from "react";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { QueryProvider } from "@/lib/query-provider";
import { RIGHT_PANEL_OPEN_STORAGE_KEY } from "@/components/features/agents/use-right-panel-open";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  WorkspaceBranchStateContext,
} from "@/state/app-state-contexts";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { WorkspaceSessions } from "./workspace-sessions-view";
import { useWorkspaceSessionPreview } from "./use-workspace-session-preview";
import { workspaceSessionSelectionStorageKey } from "./use-workspace-session-selection";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionListQueryOptions,
} from "@/state/queries/workspace-sessions";
import * as workspaceChat from "./workspace-session-chat";
import * as sessionContent from "./workspace-session-content";

// Every test here renders the full workspace session page, which can exceed 1000 ms on a loaded
// CI runner. Each test sets a 5_000 ms budget for that render.

const testWorkspaceIds = new Set<string>();
afterEach(() => {
  for (const workspaceId of testWorkspaceIds) {
    localStorage.removeItem(workspaceSessionSelectionStorageKey(workspaceId));
  }
  testWorkspaceIds.clear();
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
  createdAt: 1000,
  updatedAt: 1000,
  speed: "standard",
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
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionListActive: async () => [sessionRecord("First"), worktree],
          workspaceGetSettingsSnapshot: () => new Promise(() => {}),
          workspaceSessionArchivePreview: async () => ({
            branchName: "feature/second",
            worktreeExists: true,
            hasUncommittedChanges: true,
          }),
          workspaceSessionArchive: async (input) => {
            requests.push(input);
            return { ...worktree, archivedAt: 2000 };
          },
        },
      }),
    );
    const view = renderSessions();
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
      expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
  5_000,
);

test("a durable-list failure is an error rather than an empty Workspace and Retry reloads it", async () => {
  let reads = 0;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => {
          reads += 1;
          if (reads === 1) throw new Error("Workspace database unavailable");
          return [];
        },
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions();
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
    configureShellBridge(createUnavailableShellBridge());
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
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => {
          reads += 1;
          if (failReads) throw new Error("Workspace database unavailable");
          return [sessionRecord("First")];
        },
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      },
    }),
  );
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
  const view = renderSessions(undefined, "/chats?session=First", workspaceId, <RefetchChats />);
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
    configureShellBridge(createUnavailableShellBridge());
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
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions(
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

function renderSessions(
  runningId?: string,
  initialEntry = "/chats",
  workspaceId = crypto.randomUUID(),
  queryControls: ReactNode = null,
  previewControls: ReactNode = null,
) {
  testWorkspaceIds.add(workspaceId);
  const workspace = { workspaceId, workspaceName: "A", repoPath: "/repo" };
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
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RouteControls />
      <SessionLinks />
      <QueryProvider useIsolatedClient>
        <ThemeProvider>
          {queryControls}
          <ActiveWorkspaceContext
            value={{
              activeWorkspace: workspace,
              setActiveWorkspace: () => {},
            }}
          >
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
                        <WorkspaceSessions workspace={workspace} />
                        {previewControls}
                      </SettingsModalProvider>
                    </VisibleSessionTargetProvider>
                  </WorkspacePreviewTransitionGuardProvider>
                </WorkspaceBranchStateContext.Provider>
              </AgentSessionsContext>
            </AgentSessionReadModelStateContext>
          </ActiveWorkspaceContext>
        </ThemeProvider>
      </QueryProvider>
    </MemoryRouter>,
  );
  return { ...view, workspaceId, store };
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

test("chats share panel visibility and keep their own tools tab", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions(undefined, "/chats?session=First");
  try {
    await view.findByRole("button", { name: "Hide workspace tools panel" });
    fireEvent.click(view.getByRole("button", { name: "Hide workspace tools panel" }));
    expect(view.queryByRole("tablist", { name: "Workspace session tools" })).toBeNull();
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy(),
    );
    expect(view.getByRole("button", { name: "Show workspace tools panel" })).toBeTruthy();
    expect(view.queryByRole("tablist", { name: "Workspace session tools" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show workspace tools panel" }));
    await view.findByRole("tablist", { name: "Workspace session tools" });
    fireEvent.mouseDown(view.getByRole("tab", { name: "File explorer" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(view.getByRole("tab", { name: "File explorer" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    fireEvent.click(view.getByRole("link", { name: "Open first chat" }));
    await view.findByRole("tablist", { name: "Workspace session tools" });
    expect(view.getByRole("tab", { name: "Git" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(() =>
      expect(view.getByRole("tab", { name: "File explorer" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(localStorage.getItem(RIGHT_PANEL_OPEN_STORAGE_KEY)).toBe("true");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("workspace tools use the saved panel choice", async () => {
  localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, "false");
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions("First");
  try {
    await view.findByRole("button", { name: "Show workspace tools panel" });
    expect(view.queryByRole("tablist", { name: "Workspace session tools" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show workspace tools panel" }));
    await view.findByRole("tablist", { name: "Workspace session tools" });
    expect(localStorage.getItem(RIGHT_PANEL_OPEN_STORAGE_KEY)).toBe("true");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
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
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions(undefined, "/chats?session=First", workspaceId, <RemoveFirst />);
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
    configureShellBridge(createUnavailableShellBridge());
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
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionListActive: async () => [sessionRecord("First")],
          workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        },
      }),
    );
    const view = renderSessions(undefined, "/chats?session=First", workspaceId, <RemoveLast />);
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
      configureShellBridge(createUnavailableShellBridge());
    }
  },
  5_000,
);

test("session selection survives reload and Back/Forward without refetching workspace data", async () => {
  let listReads = 0;
  let settingsReads = 0;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => {
          listReads += 1;
          return [sessionRecord("First"), sessionRecord("Second")];
        },
        workspaceGetSettingsSnapshot: () => {
          settingsReads += 1;
          return new Promise(() => {});
        },
      },
    }),
  );
  let view = renderSessions(undefined, "/chats?keep=value");
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
    view = renderSessions(undefined, reloadUrl);
    await view.findByRole("heading", { name: "Second", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("switching loaded chats keeps only the selected session header", async () => {
  const chat = spyOn(workspaceChat, "WorkspaceSessionChat").mockImplementation(({ record }) => (
    <div role="region" aria-label="Chat transcript">
      {record.id}
    </div>
  ));
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [
          sessionRecord("First"),
          sessionRecord("Second"),
          sessionRecord("Third"),
        ],
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      },
    }),
  );
  const view = renderSessions(undefined, "/chats?session=First");
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("keeps an explicit session URL while the initial list is pending", async () => {
  let resolveList!: (records: WorkspaceSession[]) => void;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions(undefined, "/chats?session=Second");
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("restores the last session on a bare session URL and keeps workspace preferences separate", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  let view = renderSessions();
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
    expect(localStorage.getItem(workspaceSessionSelectionStorageKey(workspaceA))).toBe("Second");

    view = renderSessions();
    const workspaceB = view.workspaceId;
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
    view.unmount();
    expect(localStorage.getItem(workspaceSessionSelectionStorageKey(workspaceB))).toBe("First");

    view = renderSessions(undefined, "/chats", workspaceA);
    await view.findByRole("heading", { name: "Second", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "Second", level: 2 })).toBeTruthy();
    view.unmount();

    view = renderSessions(undefined, "/chats?session=First", workspaceA);
    await view.findByRole("heading", { name: "First", level: 2 }, { timeout: 800 });
    expect(view.getByRole("heading", { name: "First", level: 2 })).toBeTruthy();
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("does not erase the saved session while the list loads and preserves unrelated query params", async () => {
  const workspaceId = crypto.randomUUID();
  testWorkspaceIds.add(workspaceId);
  const key = workspaceSessionSelectionStorageKey(workspaceId);
  localStorage.setItem(key, "Second");
  const list = Promise.withResolvers<WorkspaceSession[]>();
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: () => list.promise,
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions(undefined, "/chats?keep=value", workspaceId);
  try {
    await view.findByText("Loading chats…", {}, { timeout: 800 });
    expect(localStorage.getItem(key)).toBe("Second");
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("keeps a missing session URL as unavailable and clears it after the final archive", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: async () => ({ ...sessionRecord("First"), archivedAt: 2000 }),
      },
    }),
  );
  const view = renderSessions(undefined, "/chats?session=Missing&keep=value");
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("an activity link selects its chat while the page is already open", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderSessions();
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("a worktree archive keeps confirmation pending until the host succeeds", async () => {
  const worktree = worktreeRecord("Second");
  const requests: WorkspaceSessionArchiveInput[] = [];
  let complete!: (record: WorkspaceSession) => void;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), worktree],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchivePreview: async () => ({
          branchName: "feature/second",
          worktreeExists: true,
          hasUncommittedChanges: false,
        }),
        workspaceSessionArchive: (input) => {
          requests.push(input);
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
      },
    }),
  );
  const view = renderSessions();
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("a failed direct archive does not show its error in the next worktree dialog", async () => {
  const worktree = worktreeRecord("Second");
  const requests: WorkspaceSessionArchiveInput[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), worktree],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchivePreview: async () => ({
          branchName: "feature/second",
          worktreeExists: true,
          hasUncommittedChanges: false,
        }),
        workspaceSessionArchive: async (input) => {
          requests.push(input);
          if (input.sessionId === "First") throw new Error("Stop failed: runtime disconnected");
          return { ...worktree, archivedAt: 2000 };
        },
      },
    }),
  );
  const view = renderSessions();
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("running archive needs confirmation and keeps the session when Stop fails", async () => {
  const requests: WorkspaceSessionArchiveInput[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: async (input) => {
          requests.push(input);
          throw new Error("Stop failed: runtime disconnected");
        },
      },
    }),
  );
  const view = renderSessions("Second");
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);

test("failed selected-chat archive keeps the dirty draft", async () => {
  let rejectArchive!: (reason: Error) => void;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: () =>
          new Promise((_resolve, reject) => {
            rejectArchive = reject;
          }),
      },
    }),
  );
  const view = renderSessions(
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
    configureShellBridge(createUnavailableShellBridge());
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
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionListActive: async () =>
            hasNextChat ? [first, sessionRecord("Second")] : [first],
          workspaceGetSettingsSnapshot: () => new Promise(() => {}),
          workspaceSessionArchive: () => archiveDone.promise,
        },
      }),
    );
    const view = renderSessions(undefined, "/chats?session=First");
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
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("an archive in flight disables repeat actions until the host succeeds", async () => {
  let complete!: (record: WorkspaceSession) => void;
  let calls = 0;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: () => {
          calls += 1;
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
      },
    }),
  );
  const view = renderSessions();
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
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5_000);
