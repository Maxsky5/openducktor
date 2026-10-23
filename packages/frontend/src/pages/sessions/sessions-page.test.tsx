import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { AgentsPage } from "@/pages/agents/agents-page";
import WorkspaceSessionsPage from "@/pages/workspace-sessions/workspace-sessions-page";
import { SessionPanel, SessionPanelsRoot, sessionPanelOwnerKey } from "@/features/session-panels";
import { useActiveWorkspace } from "@/state/app-state-provider";
import {
  createSessionPanelFixture,
  createSessionPanelsFixture,
  createTerminalSessionsFixture,
} from "@/test-utils/session-panel-fixtures";
import type { TerminalTab } from "@/features/terminals";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  ActiveWorkspaceContext,
  TaskSnapshotContext,
  TasksStateContext,
  WorkspacePresenceContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import {
  createTaskCardFixture,
  createTasksStateFixture,
  createWorkspacePresenceFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import {
  VisibleSessionTargetProvider,
  usePublishVisibleSessionTarget,
} from "@/features/session-navigation/visible-session-target";
import { SessionsPage } from "./sessions-page";
import { useSessionViewActive } from "@/features/session-navigation/session-view-context";
import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useQueryClient } from "@tanstack/react-query";
import { taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";

const realAgentsPage = { AgentsPage };
const realWorkspacePage = { default: WorkspaceSessionsPage };
const workspace = createWorkspaceRecordFixture({ workspaceId: "alpha" });

function Harness({
  initiallyClosed = false,
  visits = [],
}: {
  initiallyClosed?: boolean;
  visits?: string[];
}): ReactElement {
  const [closed, setClosed] = useState(initiallyClosed);
  const [active, setActive] = useState<ActiveWorkspace | null>(workspace);
  const [isListed, setIsListed] = useState(true);
  const other = createWorkspaceRecordFixture({ workspaceId: "beta", repoPath: "/beta" });
  const navigate = useNavigate();
  const tasks = [
    createTaskCardFixture({ id: "current", status: closed ? "closed" : "human_review" }),
    createTaskCardFixture({ id: "other", status: "closed" }),
  ];
  const workspaceState = createWorkspaceStateFixture({
    activeWorkspace: active ? { ...workspace, ...active } : null,
    workspaces: isListed ? [workspace, other] : [other],
    selectWorkspace: async (id, onSelected) => {
      setActive(id === workspace.workspaceId ? workspace : other);
      onSelected?.();
    },
  });
  return (
    <QueryProvider>
      <VisibleSessionTargetProvider>
        <ActiveWorkspaceContext.Provider
          value={{ activeWorkspace: active, setActiveWorkspace: setActive }}
        >
          <WorkspacePresenceContext.Provider value={createWorkspacePresenceFixture()}>
            <WorkspaceStateContext.Provider value={workspaceState}>
              <TasksStateContext.Provider value={createTasksStateFixture({ tasks })}>
                <TaskSnapshotContext.Provider value={{ tasks, isLoadingTasks: false }}>
                  <button type="button" onClick={() => setClosed(true)}>
                    Close current task
                  </button>
                  <button type="button" onClick={() => navigate(-1)}>
                    Back
                  </button>
                  <button
                    onClick={() =>
                      navigate(
                        "/sessions?workspace=alpha&kind=task&task=current&session=task-native&agent=planner",
                      )
                    }
                  >
                    Open task
                  </button>
                  <button
                    onClick={() => navigate("/sessions?workspace=beta&kind=workspace&session=chat")}
                  >
                    Open chat
                  </button>
                  {visits.map((href, index) => (
                    <button key={href} onClick={() => navigate(href)}>
                      Open visit {index}
                    </button>
                  ))}
                  <RemoveTask />
                  <button type="button" onClick={() => setIsListed(false)}>
                    Unlist active workspace
                  </button>
                  <button type="button" onClick={() => setActive(workspace)}>
                    Select alpha from the rail
                  </button>
                  <button type="button" onClick={() => setActive(other)}>
                    Select beta from the rail
                  </button>
                  <Routes>
                    <Route path="/before-session" element={<p>Previous page</p>} />
                    <Route path="/kanban" element={<p>Kanban board</p>} />
                    <Route path="/sessions" element={<SessionsPage />} />
                  </Routes>
                </TaskSnapshotContext.Provider>
              </TasksStateContext.Provider>
            </WorkspaceStateContext.Provider>
          </WorkspacePresenceContext.Provider>
        </ActiveWorkspaceContext.Provider>
      </VisibleSessionTargetProvider>
    </QueryProvider>
  );
}

function RemoveTask() {
  const client = useQueryClient();
  return (
    <button
      onClick={() => client.setQueryData(taskQueryKeys.repoData(workspace.repoPath), { tasks: [] })}
    >
      Remove task
    </button>
  );
}

test.each(["partial", "fresh"] as const)(
  "a %s task address keeps its resolved view across session switches",
  async (address) => {
    function Conversation() {
      const params = new URLSearchParams(useLocation().search);
      const runtimeKind = params.get("session") === "native-codex" ? "codex" : "opencode";
      const target = useMemo<SessionNavigationTarget>(
        () => ({
          kind: "task_session" as const,
          workspaceId: "alpha",
          taskId: "current",
          role: "planner" as const,
          identity: {
            externalSessionId: `native-${runtimeKind}`,
            runtimeKind,
            workingDirectory: "/repo",
          },
        }),
        [runtimeKind],
      );
      usePublishVisibleSessionTarget(target);
      return <input aria-label={`${runtimeKind} draft`} />;
    }
    mock.module("@/pages/agents/agents-page", () => ({ AgentsPage: Conversation }));
    const href = (runtime: string) =>
      `/sessions?workspace=alpha&kind=task&task=current&session=native-${runtime}&agent=planner`;
    const view = render(
      <MemoryRouter
        initialEntries={[
          `/sessions?workspace=alpha&kind=task&task=current${address === "partial" ? "&session=native-opencode" : ""}&agent=planner`,
        ]}
      >
        <Harness visits={[href("opencode"), href("codex")]} />
      </MemoryRouter>,
    );
    try {
      const first = view.getByLabelText("opencode draft");
      fireEvent.change(first, { target: { value: "Kept draft" } });
      fireEvent.click(view.getByRole("button", { name: "Open visit 1" }));
      expect(view.getByLabelText("codex draft") === first).toBe(false);
      expect(first.isConnected).toBe(true);
      expect(view.container.querySelectorAll("input")).toHaveLength(2);
      fireEvent.click(view.getByRole("button", { name: "Open visit 0" }));
      expect(view.getAllByLabelText("opencode draft")).toHaveLength(1);
      expect(view.getByLabelText("opencode draft") === first).toBe(true);
      expect(view.getByDisplayValue("Kept draft")).toBe(first);
    } finally {
      view.unmount();
      mock.module("@/pages/agents/agents-page", () => realAgentsPage);
    }
  },
);

test.each([
  [
    "task",
    "/sessions?workspace=alpha&kind=task&task=current&session=native-opencode&agent=planner",
  ],
  ["workspace", "/sessions?workspace=alpha&kind=workspace&session=chat"],
] as const)(
  "a rail switch returns to the kept %s view of the workspace",
  async (kind, keptHref) => {
    let mounts = 0;
    // Like the real content, new content without a selection restores its saved selection.
    function Conversation() {
      const [mount] = useState(() => ++mounts);
      // Views that do not settle mount new content without end inside one click.
      if (mount > 3) throw new Error("Session views mounted a fourth conversation.");
      const workspaceId = useActiveWorkspace()!.workspaceId;
      const navigate = useNavigate();
      const isActive = useSessionViewActive();
      const location = useLocation();
      const [restores] = useState(
        () => !new URLSearchParams(location.search).has(kind === "task" ? "task" : "session"),
      );
      useEffect(() => {
        if (isActive && restores) {
          navigate(keptHref.replace("workspace=alpha", `workspace=${workspaceId}`), {
            replace: true,
          });
        }
      }, [isActive, navigate, restores, workspaceId]);
      return <input aria-label={`${workspaceId} draft`} />;
    }
    const page = { AgentsPage: Conversation };
    mock.module("@/pages/agents/agents-page", () => page);
    mock.module("@/pages/workspace-sessions/workspace-sessions-page", () => ({
      default: Conversation,
    }));
    const view = render(
      <MemoryRouter initialEntries={[keptHref]}>
        <Harness />
        <Address />
      </MemoryRouter>,
    );
    try {
      const kept = view.getByLabelText("alpha draft");
      fireEvent.change(kept, { target: { value: "Kept draft" } });
      for (let round = 0; round < 3; round += 1) {
        fireEvent.click(view.getByRole("button", { name: "Select beta from the rail" }));
        await view.findByLabelText("beta draft");
        fireEvent.click(view.getByRole("button", { name: "Select alpha from the rail" }));
        await waitFor(() => expect(view.getByLabelText("Address").textContent).toBe(keptHref));
      }
      expect(view.getByLabelText("alpha draft")).toBe(kept);
      expect(view.getByDisplayValue("Kept draft")).toBe(kept);
      expect(mounts).toBe(2);
    } finally {
      view.unmount();
      mock.module("@/pages/agents/agents-page", () => realAgentsPage);
      mock.module("@/pages/workspace-sessions/workspace-sessions-page", () => realWorkspacePage);
    }
  },
);

function Address() {
  const location = useLocation();
  return <output aria-label="Address">{`${location.pathname}${location.search}`}</output>;
}

test("task and chat views share six slots and removed tasks release their kept views", async () => {
  function Conversation() {
    const location = useLocation();
    return <input aria-label={new URLSearchParams(location.search).get("session") ?? "empty"} />;
  }
  mock.module("@/pages/agents/agents-page", () => ({ AgentsPage: Conversation }));
  mock.module("@/pages/workspace-sessions/workspace-sessions-page", () => ({
    default: Conversation,
  }));
  const visits = Array.from({ length: 6 }, (_, index) =>
    index % 2 === 0 || index === 5
      ? `/sessions?workspace=beta&kind=workspace&session=visit-${index}`
      : `/sessions?workspace=alpha&kind=task&task=current&session=visit-${index}&agent=planner`,
  );
  const view = render(
    <MemoryRouter
      initialEntries={[
        "/sessions?workspace=alpha&kind=task&task=current&session=first&agent=planner",
      ]}
    >
      <Harness visits={visits} />
    </MemoryRouter>,
  );
  try {
    const first = view.getByLabelText("first");
    for (let index = 0; index < visits.length; index += 1) {
      fireEvent.click(view.getByRole("button", { name: `Open visit ${index}` }));
      const input = await view.findByLabelText(`visit-${index}`);
      fireEvent.change(input, { target: { value: `Draft ${index}` } });
      if (index < 5) expect(first.isConnected).toBe(true);
    }
    expect(first.isConnected).toBe(false);
    expect(view.container.querySelectorAll("input")).toHaveLength(6);
    const task = view.getByLabelText("visit-1");
    const chat = view.getByLabelText("visit-0");
    if (!(chat instanceof HTMLInputElement)) throw new Error("Expected a chat draft input");
    fireEvent.click(view.getByRole("button", { name: "Remove task" }));
    expect(task.isConnected).toBe(false);
    expect(chat.isConnected).toBe(true);
    expect(chat.value).toBe("Draft 0");
    expect(view.container.querySelectorAll("input")).toHaveLength(4);
  } finally {
    view.unmount();
    mock.module("@/pages/agents/agents-page", () => realAgentsPage);
    mock.module("@/pages/workspace-sessions/workspace-sessions-page", () => realWorkspacePage);
  }
});

test("task and chat switches keep their inputs and terminal viewports and stop hidden effects", async () => {
  const activeEffects = new Set<string>();
  function Conversation() {
    const current = useActiveWorkspace()!;
    const location = useLocation();
    const kind = new URLSearchParams(location.search).get("kind");
    const key = `${current.workspaceId}:${kind}`;
    const isActive = useSessionViewActive();
    useEffect(() => {
      if (!isActive) return;
      activeEffects.add(key);
      return () => {
        activeEffects.delete(key);
      };
    }, [isActive, key]);
    const scopeKey = sessionPanelOwnerKey(
      kind === "task"
        ? { kind: "task", workspaceId: current.workspaceId, taskId: "current" }
        : { kind: "chat", workspaceId: current.workspaceId, sessionId: "chat" },
    );
    const tab: TerminalTab = {
      tabId: key,
      terminalId: key,
      awaitingLifecycleSync: false,
      error: null,
      requestState: "ready",
      summary: {
        terminalId: key,
        label: key,
        context: { repoPath: current.repoPath, taskId: "current" },
        initialWorkingDir: current.repoPath,
        createdAt: "2026-10-18T00:00:00.000Z",
        lifecycle: "running",
        exit: null,
        startedBy: "user",
      },
    };
    const panel = createSessionPanelFixture({
      tabs: [{ id: key, kind: "terminal", terminal: tab }],
      selectedTabId: key,
      terminals: createTerminalSessionsFixture({
        scopeKey,
        tabs: [tab],
        mountedTabs: [{ scopeKey, tab }],
      }),
      terminalMounts: [{ key, scopeKey, tab, value: key }],
      activeTerminalKey: key,
    });
    return (
      <SessionPanelsRoot panels={createSessionPanelsFixture({ right: panel })}>
        <input aria-label={`${key} draft`} />
        <SessionPanel model={panel} />
      </SessionPanelsRoot>
    );
  }
  mock.module("@/pages/agents/agents-page", () => ({ AgentsPage: Conversation }));
  mock.module("@/pages/workspace-sessions/workspace-sessions-page", () => ({
    default: Conversation,
  }));
  const view = render(
    <MemoryRouter
      initialEntries={[
        "/sessions?workspace=alpha&kind=task&task=current&session=task-native&agent=planner",
      ]}
    >
      <Harness />
    </MemoryRouter>,
  );
  try {
    const task = view.getByLabelText("alpha:task draft");
    if (!(task instanceof HTMLInputElement)) throw new Error("Expected a task draft input");
    const terminal = view.container.querySelector("[data-terminal-viewport]");
    fireEvent.change(task, { target: { value: "Task draft" } });
    fireEvent.click(view.getByRole("button", { name: "Open chat" }));
    const chat = await view.findByLabelText("beta:workspace draft");
    if (!(chat instanceof HTMLInputElement)) throw new Error("Expected a chat draft input");
    expect(task.isConnected).toBe(true);
    expect(terminal?.isConnected).toBe(true);
    expect([...activeEffects]).toEqual(["beta:workspace"]);
    fireEvent.change(chat, { target: { value: "Chat draft" } });
    fireEvent.click(view.getByRole("button", { name: "Open task" }));
    await waitFor(() => expect([...activeEffects]).toEqual(["alpha:task"]));
    expect(view.getByLabelText("alpha:task draft")).toBe(task);
    expect(task.value).toBe("Task draft");
    expect(chat.isConnected).toBe(true);
    expect(chat.value).toBe("Chat draft");
    expect(terminal?.isConnected).toBe(true);
  } finally {
    view.unmount();
    mock.module("@/pages/agents/agents-page", () => realAgentsPage);
    mock.module("@/pages/workspace-sessions/workspace-sessions-page", () => realWorkspacePage);
  }
});

test("drops the task view when its workspace leaves the list before the active workspace changes", () => {
  function Conversation() {
    return <input aria-label="Task draft" />;
  }
  mock.module("@/pages/agents/agents-page", () => ({ AgentsPage: Conversation }));
  const view = render(
    <MemoryRouter
      initialEntries={["/sessions?workspace=alpha&kind=task&task=current&agent=planner"]}
    >
      <Harness />
    </MemoryRouter>,
  );
  try {
    const draft = view.getByLabelText("Task draft");
    fireEvent.click(view.getByRole("button", { name: "Unlist active workspace" }));
    expect(draft.isConnected).toBe(false);
    expect(view.getByRole("button", { name: "Unlist active workspace" })).toBeTruthy();
  } finally {
    view.unmount();
    mock.module("@/pages/agents/agents-page", () => realAgentsPage);
  }
});

test("leaves an open task visible, then replaces its closed session route with Kanban", async () => {
  mock.module("@/pages/agents/agents-page", () => ({
    AgentsPage: () => <p>Task conversation</p>,
  }));
  const view = render(
    <MemoryRouter
      initialEntries={["/before-session", "/sessions?workspace=alpha&kind=task&task=current"]}
    >
      <Harness />
    </MemoryRouter>,
  );
  try {
    expect(screen.getByText("Task conversation")).toBeTruthy();
    expect(screen.queryByText("Kanban board")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close current task" }));
    await waitFor(() => expect(screen.getByText("Kanban board")).toBeTruthy());
    expect(screen.queryByText("Task conversation")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByText("Previous page")).toBeTruthy());
  } finally {
    view.unmount();
    mock.module("@/pages/agents/agents-page", () => realAgentsPage);
  }
});

test("redirects a saved closed-task address before mounting its conversation", async () => {
  const mountConversation = mock(() => <p>Task conversation</p>);
  mock.module("@/pages/agents/agents-page", () => ({ AgentsPage: mountConversation }));
  const view = render(
    <MemoryRouter initialEntries={["/sessions?workspace=alpha&kind=task&task=current"]}>
      <Harness initiallyClosed />
    </MemoryRouter>,
  );
  try {
    await waitFor(() => expect(screen.getByText("Kanban board")).toBeTruthy());
    expect(mountConversation).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    mock.module("@/pages/agents/agents-page", () => realAgentsPage);
  }
});
