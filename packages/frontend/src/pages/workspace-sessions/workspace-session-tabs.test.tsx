import { afterEach, expect, jest, spyOn, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionArchiveInput } from "@openducktor/contracts";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
} from "@/state/app-state-contexts";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import WorkspaceSessionsPage from "./workspace-sessions-page";
import { workspaceSessionSelectionStorageKey } from "./use-workspace-session-selection";
import { workspaceSessionTabOrderStorageKey } from "./use-workspace-session-tab-order";
import { updateWorkspaceSessionQueries } from "@/state/queries/workspace-sessions";
import * as chatCreate from "./workspace-session-create-dialog";
import * as workspaceChat from "./workspace-session-chat";

const testWorkspaceIds = new Set<string>();
afterEach(() => {
  for (const workspaceId of testWorkspaceIds) {
    localStorage.removeItem(workspaceSessionSelectionStorageKey(workspaceId));
    localStorage.removeItem(workspaceSessionTabOrderStorageKey(workspaceId));
  }
  testWorkspaceIds.clear();
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

test.each([true, false])(
  "worktree archive opens a modal on the first click and sends removal=%s only after confirmation",
  async (removeWorktree) => {
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
    const view = renderTabs();
    try {
      fireEvent.click(
        await view.findByRole("button", { name: "Archive Second" }, { timeout: 800 }),
      );
      expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
      expect(requests).toEqual([]);
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      expect(view.queryByRole("dialog")).toBeNull();
      expect(requests).toEqual([]);
      fireEvent.click(view.getByRole("button", { name: "Archive Second" }));
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
      expect(view.getByText(/Archiving stops this session if it is running/)).toBeTruthy();
      expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      if (!removeWorktree) fireEvent.click(view.getByRole("switch"));
      const submit = view.getByRole("button", { name: "Archive chat" });
      await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false), { timeout: 800 });
      fireEvent.click(submit);
      await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true), { timeout: 800 });
      expect(requests).toEqual([
        { workspaceId: view.workspaceId, sessionId: "Second", confirmStop: true, removeWorktree },
      ]);
      expect(view.getAllByRole("tab")).toHaveLength(1);
      expect(view.getByRole("tab", { name: /First/ }).getAttribute("aria-selected")).toBe("true");
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("New chat opens and closes over the selected session without changing its URL", async () => {
  const createDialog = spyOn(chatCreate, "WorkspaceSessionCreateDialog").mockImplementation(
    (props) => (
      <div role="dialog" aria-label="Chat creation">
        <button type="button" onClick={props.onClose}>
          Cancel chat
        </button>
      </div>
    ),
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const route = "/chats?session=First&keep=value";
  const view = renderTabs(undefined, route);
  try {
    fireEvent.click(await view.findByRole("button", { name: "New chat" }, { timeout: 800 }));
    expect(view.getByRole("dialog", { name: "Chat creation" })).toBeTruthy();
    expect(view.getByTestId("session-url").textContent).toBe(route);
    fireEvent.click(view.getByRole("button", { name: "Cancel chat" }));
    expect(view.queryByRole("dialog", { name: "Chat creation" })).toBeNull();
    expect(view.getByTestId("session-url").textContent).toBe(route);
  } finally {
    view.unmount();
    createDialog.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("tabs show older chats first even when the server lists recent activity first", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [
          { ...sessionRecord("New"), createdAt: 2000, updatedAt: 2000 },
          sessionRecord("Old"),
        ],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderTabs();
  try {
    await view.findByRole("tab", { name: /New/ }, { timeout: 800 });
    expect(view.getAllByRole("tab").map((tab) => tab.getAttribute("title"))).toEqual([
      "Old",
      "New",
    ]);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

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
  const view = renderTabs();
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
});

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

test("new drafts append right and metadata updates do not move tabs or change selection", async () => {
  const workspaceId = crypto.randomUUID();
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderTabs(
    undefined,
    "/chats?session=Second",
    workspaceId,
    <SessionMetadataControls workspaceId={workspaceId} />,
  );
  const titles = () => view.getAllByRole("tab").map((tab) => tab.getAttribute("title"));
  try {
    await view.findByRole("tab", { name: /Second/ }, { timeout: 800 });
    fireEvent.click(view.getByRole("button", { name: "Add draft fixture" }));
    await waitFor(() => expect(titles()).toEqual(["First", "Second", "Draft"]), { timeout: 800 });
    fireEvent.click(view.getByRole("button", { name: "Update first fixture" }));
    await act(async () => {});
    expect(titles()).toEqual(["First", "Second", "Draft"]);
    fireEvent.click(view.getByRole("button", { name: "Start draft fixture" }));
    await act(async () => {});
    expect(titles()).toEqual(["First", "Second", "Draft"]);
    expect(view.getByRole("tab", { name: /Second/ }).getAttribute("aria-selected")).toBe("true");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

function renderTabs(
  runningId?: string,
  initialEntry = "/chats",
  workspaceId = crypto.randomUUID(),
  queryControls: ReactNode = null,
) {
  testWorkspaceIds.add(workspaceId);
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
      <Link to="/chats?session=Second">Open second chat</Link>
      <Link to="/chats">Open chats</Link>
      <QueryProvider useIsolatedClient>
        {queryControls}
        <ActiveWorkspaceContext
          value={{
            activeWorkspace: { workspaceId, workspaceName: "A", repoPath: "/repo" },
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
              <WorkspaceSessionsPage />
            </AgentSessionsContext>
          </AgentSessionReadModelStateContext>
        </ActiveWorkspaceContext>
      </QueryProvider>
    </MemoryRouter>,
  );
  return { ...view, workspaceId, store };
}

test("tabs read activity without subscribing to session transcripts", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderTabs("First");
  const readTranscript = spyOn(view.store, "getSessionSnapshot");
  try {
    await view.findByRole("tab", { name: /First/ }, { timeout: 2000 });
    expect(view.getByLabelText("running")).toBeTruthy();
    await act(async () => {
      view.store.replaceSession(
        createAgentSessionFixture({
          runtimeKind: "opencode",
          externalSessionId: "native-First",
          workingDirectory: "/repo",
          sessionAssociation: { kind: "repository" },
          status: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        }),
      );
    });
    expect(view.getByLabelText("idle")).toBeTruthy();
    expect(readTranscript).not.toHaveBeenCalled();
  } finally {
    readTranscript.mockRestore();
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5000);

test("drag preview keeps the normal tab status dot and button styling", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderTabs("First");
  try {
    const tab = await view.findByRole("tab", { name: /First/ }, { timeout: 800 });
    fireEvent.pointerDown(tab, {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 10 });
    await waitFor(() => expect(view.getAllByLabelText("running")).toHaveLength(2), {
      timeout: 800,
    });
    const dots = view.getAllByLabelText("running");
    expect(dots[1]?.className).toBe(dots[0]?.className);
    const buttons = view.getAllByLabelText("Archive First");
    expect(buttons).toHaveLength(2);
    expect(buttons[1]?.className).toBe(buttons[0]?.className);
    const tabs = view
      .getAllByRole("tab", { hidden: true })
      .filter((entry) => entry.getAttribute("title") === "First");
    expect(tabs).toHaveLength(2);
    expect(tabs[1]?.className).toBe(tabs[0]?.className);
    expect(tabs[1]?.parentElement?.className).toBe(
      tabs[0]?.parentElement?.className.replace(" opacity-0", ""),
    );
    fireEvent.pointerUp(document, { pointerId: 1 });
  } finally {
    fireEvent.pointerCancel(document, { pointerId: 1 });
    view.unmount();
    // dnd-kit's AbstractPointerSensor removes its document click blocker after 50 ms.
    await new Promise((resolve) => setTimeout(resolve, 50));
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("tab selection survives reload and Back/Forward without refetching workspace data", async () => {
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
  let view = renderTabs(undefined, "/chats?keep=value");
  try {
    const first = await view.findByRole("tab", { name: /First/ }, { timeout: 800 });
    const second = view.getByRole("tab", { name: /Second/ });
    fireEvent.mouseUp(second, { button: 0, ctrlKey: false });
    expect(second.getAttribute("aria-selected")).toBe("true");
    await waitFor(
      () =>
        expect(view.getByTestId("session-url").textContent).toBe(
          "/chats?keep=value&session=Second",
        ),
      { timeout: 800 },
    );
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(first.getAttribute("aria-selected")).toBe("true"), { timeout: 800 });
    fireEvent.click(view.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(second.getAttribute("aria-selected")).toBe("true"), {
      timeout: 800,
    });
    expect(listReads).toBe(1);
    expect(settingsReads).toBe(1);
    const reloadUrl = view.getByTestId("session-url").textContent ?? "";
    view.unmount();
    view = renderTabs(undefined, reloadUrl);
    const restored = await view.findByRole("tab", { name: /Second/ }, { timeout: 800 });
    expect(restored.getAttribute("aria-selected")).toBe("true");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("switching loaded chats keeps only the selected session header", async () => {
  const chat = spyOn(workspaceChat, "WorkspaceSessionChat").mockImplementation(({ record }) => (
    <div data-testid="selected-chat">{record.id}</div>
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
  const view = renderTabs(undefined, "/chats?session=First");
  try {
    await view.findByTestId("selected-chat", {}, { timeout: 800 });
    expect(view.getAllByRole("heading", { level: 2 }).map((header) => header.textContent)).toEqual([
      "First",
    ]);
    for (const selected of ["Second", "Third", "First", "Second", "Third"]) {
      fireEvent.mouseUp(view.getByRole("tab", { name: new RegExp(selected) }), {
        button: 0,
        ctrlKey: false,
      });
      await waitFor(() => expect(view.getByTestId("selected-chat").textContent).toBe(selected), {
        timeout: 800,
      });
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
    expect(view.getByTestId("selected-chat").textContent).toBe("Second");
  } finally {
    view.unmount();
    chat.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});

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
  const view = renderTabs(undefined, "/chats?session=Second");
  try {
    await view.findByText("Loading chats…", {}, { timeout: 800 });
    expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Second");
    await act(async () => {
      resolveList([sessionRecord("First"), sessionRecord("Second")]);
    });
    const selected = await view.findByRole("tab", { name: /Second/ }, { timeout: 800 });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Second");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("restores the last session on a bare Chats URL and keeps workspace preferences separate", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  let view = renderTabs();
  const workspaceA = view.workspaceId;
  try {
    await view.findByRole("tab", { name: /Second/ }, { timeout: 800 });
    fireEvent.mouseUp(view.getByRole("tab", { name: /Second/ }), { button: 0, ctrlKey: false });
    fireEvent.click(view.getByRole("link", { name: "Open chats" }));
    await waitFor(
      () => expect(view.getByTestId("session-url").textContent).toBe("/chats?session=Second"),
      { timeout: 800 },
    );
    view.unmount();
    expect(localStorage.getItem(workspaceSessionSelectionStorageKey(workspaceA))).toBe("Second");

    view = renderTabs();
    const workspaceB = view.workspaceId;
    const first = await view.findByRole("tab", { name: /First/ }, { timeout: 800 });
    expect(first.getAttribute("aria-selected")).toBe("true");
    view.unmount();
    expect(localStorage.getItem(workspaceSessionSelectionStorageKey(workspaceB))).toBe("First");

    view = renderTabs(undefined, "/chats", workspaceA);
    const restored = await view.findByRole("tab", { name: /Second/ }, { timeout: 800 });
    expect(restored.getAttribute("aria-selected")).toBe("true");
    view.unmount();

    view = renderTabs(undefined, "/chats?session=First", workspaceA);
    const explicit = await view.findByRole("tab", { name: /First/ }, { timeout: 800 });
    expect(explicit.getAttribute("aria-selected")).toBe("true");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

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
  const view = renderTabs(undefined, "/chats?keep=value", workspaceId);
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
    expect(view.getByRole("tab", { name: /Second/ }).getAttribute("aria-selected")).toBe("true");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("replaces a missing session URL and clears it after the final archive", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: async () => ({ ...sessionRecord("First"), archivedAt: 2000 }),
      },
    }),
  );
  const view = renderTabs(undefined, "/chats?session=Missing&keep=value");
  try {
    await view.findByRole("tab", { name: /First/ }, { timeout: 800 });
    await waitFor(
      () =>
        expect(view.getByTestId("session-url").textContent).toBe("/chats?session=First&keep=value"),
      { timeout: 800 },
    );
    fireEvent.click(view.getByRole("button", { name: "Archive First" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm stop and archive First" }));
    });
    await view.findByText("No active sessions.", {}, { timeout: 800 });
    await waitFor(
      () => expect(view.getByTestId("session-url").textContent).toBe("/chats?keep=value"),
      { timeout: 800 },
    );
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect(view.getByTestId("session-url").textContent).toBe("/chats?keep=value");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("an activity link selects its chat while the page is already open", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
      },
    }),
  );
  const view = renderTabs();
  try {
    const first = await view.findByRole("tab", { name: /First/ }, { timeout: 800 });
    const second = view.getByRole("tab", { name: /Second/ });
    expect(first.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(() => expect(second.getAttribute("aria-selected")).toBe("true"), {
      timeout: 800,
    });
    fireEvent.mouseUp(first, { button: 0, ctrlKey: false });
    expect(first.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(view.getByRole("link", { name: "Open second chat" }));
    await waitFor(() => expect(second.getAttribute("aria-selected")).toBe("true"), {
      timeout: 800,
    });
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("archive targets its tab, restore preserves selection, and the final archive shows the empty state", async () => {
  const first = sessionRecord("First");
  const second = sessionRecord("Second");
  let archived: WorkspaceSession[] = [];
  const requests: WorkspaceSessionArchiveInput[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [first, second],
        workspaceSessionListArchived: async () => archived,
        // Tab actions must work before the separate chat settings read completes.
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: async (input) => {
          requests.push(input);
          const record = { ...(input.sessionId === first.id ? first : second), archivedAt: 2000 };
          archived = [...archived, record];
          return record;
        },
        workspaceSessionRestore: async () => {
          archived = archived.filter((record) => record.id !== second.id);
          return second;
        },
      },
    }),
  );
  const view = renderTabs();
  try {
    const firstTab = await view.findByRole("tab", { name: /First/ }, { timeout: 800 });
    expect(firstTab.getAttribute("aria-selected")).toBe("true");
    expect(view.getByRole("tabpanel").id).toBe(firstTab.getAttribute("aria-controls") ?? "");
    const scrollRegion = firstTab.closest(".hide-scrollbar");
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.contains(view.getByRole("button", { name: "New chat" }))).toBe(false);
    expect(scrollRegion?.contains(view.getByRole("button", { name: "Session history" }))).toBe(
      false,
    );
    const newChat = view.getByRole("button", { name: "New chat" });
    expect(newChat.classList.contains("hover:bg-transparent")).toBe(true);
    expect(newChat.querySelector("svg")?.classList.contains("size-5")).toBe(true);
    expect(
      view
        .getByRole("button", { name: "Session history" })
        .classList.contains("hover:bg-transparent"),
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Archive Second" }));
    await act(async () => {
      expect(requests).toHaveLength(0);
      expect(view.queryByRole("dialog")).toBeNull();
      expect(firstTab.getAttribute("aria-selected")).toBe("true");
      fireEvent.click(view.getByRole("button", { name: "Confirm stop and archive Second" }));
    });
    await waitFor(() => expect(view.queryByText("Second") === null).toBe(true), { timeout: 800 });
    expect(firstTab.getAttribute("aria-selected")).toBe("true");
    expect(requests).toEqual([
      {
        workspaceId: view.workspaceId,
        sessionId: "Second",
        confirmStop: true,
        removeWorktree: false,
      },
    ]);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Session history" }));
    });
    const restore = await view.findByRole("button", { name: "Restore Second" }, { timeout: 800 });
    await act(async () => {
      fireEvent.click(restore);
    });
    await view.findByText("No archived sessions.", {}, { timeout: 800 });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Close" }));
    });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull(), { timeout: 800 });
    expect(view.getByRole("tab", { name: /First/ }).getAttribute("aria-selected")).toBe("true");
    expect(view.getByRole("tab", { name: /Second/ }).getAttribute("aria-selected")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Archive First" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm stop and archive First" }));
    });
    await waitFor(
      () =>
        expect(view.getByRole("tab", { name: /Second/ }).getAttribute("aria-selected")).toBe(
          "true",
        ),
      { timeout: 800 },
    );
    fireEvent.click(view.getByRole("button", { name: "Archive Second" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm stop and archive Second" }));
    });
    await view.findByText("No active sessions.", {}, { timeout: 800 });
    expect(view.queryAllByRole("tab")).toHaveLength(0);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a slow worktree archive keeps its loader on the tab while the dialog is pending and removes the tab on success", async () => {
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
  const view = renderTabs();
  try {
    fireEvent.click(await view.findByRole("button", { name: "Archive Second" }, { timeout: 800 }));
    expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Archive Second", hidden: true })).toBeTruthy();
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
      },
    ]);
    expect(view.getByRole("dialog", { name: "Archive chat" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Archiving…" }).hasAttribute("disabled")).toBe(true);
    const archiving = view.getByRole("button", { name: "Archiving Second", hidden: true });
    expect(archiving.hasAttribute("disabled")).toBe(true);
    expect(archiving.querySelector('svg[class*="motion-safe:animate-spin"]')).not.toBeNull();
    await act(async () => {
      complete({ ...worktree, archivedAt: 2000 });
    });
    await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true), { timeout: 800 });
    await waitFor(() => expect(view.queryByRole("tab", { name: /Second/ }) === null).toBe(true), {
      timeout: 800,
    });
    expect(view.queryByRole("button", { name: "Archiving Second" })).toBeNull();
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

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
  const view = renderTabs();
  try {
    fireEvent.click(await view.findByRole("button", { name: "Archive First" }, { timeout: 800 }));
    fireEvent.click(view.getByRole("button", { name: "Confirm stop and archive First" }));
    await view.findByText("Stop failed: runtime disconnected", {}, { timeout: 800 });
    fireEvent.click(view.getByRole("button", { name: "Archive Second" }));
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
    await waitFor(() => expect(view.queryByRole("tab", { name: /Second/ }) === null).toBe(true), {
      timeout: 800,
    });
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
      },
    ]);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("archive confirmation expires after five seconds and only one tab is armed", async () => {
  let calls = 0;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionListActive: async () => [sessionRecord("First"), sessionRecord("Second")],
        workspaceGetSettingsSnapshot: () => new Promise(() => {}),
        workspaceSessionArchive: async () => {
          calls += 1;
          return sessionRecord("First");
        },
      },
    }),
  );
  const view = renderTabs();
  try {
    await view.findByRole("button", { name: "Archive First" }, { timeout: 800 });
    jest.useFakeTimers();
    fireEvent.click(view.getByRole("button", { name: "Archive First" }));
    act(() => jest.advanceTimersByTime(4_999));
    expect(view.getByRole("button", { name: "Confirm stop and archive First" })).toBeTruthy();
    expect(
      view
        .getByRole("button", { name: "Confirm stop and archive First" })
        .classList.contains("text-foreground"),
    ).toBe(true);
    expect(
      view
        .getByRole("button", { name: "Confirm stop and archive First" })
        .classList.contains("opacity-100"),
    ).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByRole("button", { name: "Archive First" })).toBeTruthy();
    expect(calls).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Archive First" }));
    fireEvent.click(view.getByRole("button", { name: "Archive Second" }));
    expect(view.getByRole("button", { name: "Archive First" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Confirm stop and archive Second" })).toBeTruthy();
    expect(calls).toBe(0);
  } finally {
    view.unmount();
    jest.useRealTimers();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("running archive confirms inline and retains the tab and selection when Stop fails", async () => {
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
  const view = renderTabs("Second");
  try {
    fireEvent.click(await view.findByRole("button", { name: "Archive Second" }, { timeout: 800 }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(requests).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Confirm stop and archive Second" }));
    await view.findByText("Stop failed: runtime disconnected", {}, { timeout: 800 });
    expect(view.queryByRole("button", { name: "Archiving Second" })).toBeNull();
    expect(view.getByRole("button", { name: "Archive Second" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(requests).toEqual([
      {
        workspaceId: view.workspaceId,
        sessionId: "Second",
        confirmStop: true,
        removeWorktree: false,
      },
    ]);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getAllByRole("tab")).toHaveLength(2);
    expect(view.getByRole("tab", { name: /First/ }).getAttribute("aria-selected")).toBe("true");
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("an archive in flight shows a loader on its tab, disables all archive controls, and removes the tab when it settles", async () => {
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
  const view = renderTabs();
  try {
    fireEvent.click(await view.findByRole("button", { name: "Archive Second" }, { timeout: 800 }));
    expect(calls).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Confirm stop and archive Second" }));
    const archiving = await view.findByRole(
      "button",
      { name: "Archiving Second" },
      { timeout: 800 },
    );
    expect(archiving.hasAttribute("disabled")).toBe(true);
    expect(archiving.getAttribute("aria-busy")).toBe("true");
    expect(archiving.querySelectorAll("svg")).toHaveLength(3);
    expect(archiving.querySelector('svg[class*="motion-safe:animate-spin"]')).not.toBeNull();
    expect(archiving.classList.contains("text-foreground")).toBe(true);
    expect(archiving.classList.contains("disabled:opacity-100")).toBe(true);
    expect(view.getByRole("tab", { name: /Second/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Archive First" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Archive First" }));
    expect(calls).toBe(1);
    await act(async () => {
      complete({ ...sessionRecord("Second"), archivedAt: 2000 });
    });
    await waitFor(() => expect(view.queryByRole("tab", { name: /Second/ }) === null).toBe(true), {
      timeout: 800,
    });
    expect(view.queryByRole("button", { name: "Archiving Second" })).toBeNull();
    expect(view.getByRole("button", { name: "Archive First" }).hasAttribute("disabled")).toBe(
      false,
    );
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});
