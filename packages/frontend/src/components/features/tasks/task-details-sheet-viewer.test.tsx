import { expect, test } from "bun:test";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import {
  ActiveWorkspaceContext,
  TaskSnapshotContext,
  WorkspaceStateContext,
  type TaskSnapshotContextValue,
} from "@/state/app-state-contexts";
import { taskQueryKeys, type RepoTaskData } from "@/state/queries/tasks";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { AgentChatTaskTool } from "../agents/agent-chat/agent-chat-task-tool";
import TaskDetailsSheetViewer from "./task-details-sheet-viewer";

const activeWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  abbreviation: null,
  tileColor: null,
  repoPath: "/repo-a",
};
const createWorkspaceState = (): WorkspaceStateContextValue => ({
  activeWorkspace: {
    ...activeWorkspace,
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/tmp/worktrees",
    effectiveWorktreeBasePath: "/tmp/worktrees",
  },
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [],
  closedWorkspaces: [],
  incompleteRemovals: [],
  branches: [],
  activeBranch: null,
  addWorkspace: async () => {},
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
    throw new Error("Unused");
  },
  saveRepoSettings: async () => {},
  loadSettingsSnapshot: async () => {
    throw new Error("Unused");
  },
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => {},
  saveSettingsSnapshot: async () => {},
  saveAgentModelFavorites: async () => {
    throw new Error("Unused");
  },
});

function createHarness(
  snapshot: TaskSnapshotContextValue,
  initialize?: (client: QueryClient) => void,
) {
  let queryClient: QueryClient;
  const closed: boolean[] = [];
  function Providers({ children }: { children: ReactNode }) {
    queryClient = useQueryClient();
    useState(() => {
      initialize?.(queryClient);
    });
    return (
      <ActiveWorkspaceContext value={{ activeWorkspace, setActiveWorkspace: () => {} }}>
        <WorkspaceStateContext value={createWorkspaceState()}>
          <TaskSnapshotContext value={snapshot}>{children}</TaskSnapshotContext>
        </WorkspaceStateContext>
      </ActiveWorkspaceContext>
    );
  }
  const viewer = (
    <TaskDetailsSheetViewer taskId="task-1" onOpenChange={(open) => closed.push(open)} />
  );
  const h = render(viewer, {
    wrapper: ({ children }) => (
      <QueryProvider useIsolatedClient>
        <Providers>{children}</Providers>
      </QueryProvider>
    ),
  });
  return {
    ...h,
    closed,
    queryClient: queryClient!,
    dispose: () => {
      h.unmount();
      queryClient.clear();
    },
  };
}

test("shows a closeable skeleton while context tasks load, then shows the task", async () => {
  const snapshot: TaskSnapshotContextValue = { tasks: [], isLoadingTasks: true };
  const h = createHarness(snapshot);
  try {
    const dialog = h.getByRole("dialog", { name: "Task Details" });
    expect(within(dialog).getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(dialog.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(5);
    expect(h.container.textContent).not.toContain("Loading task details");
    expect(h.queryClient.isFetching({ queryKey: taskQueryKeys.all })).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(h.closed).toEqual([false]);
    snapshot.tasks = [createTaskCardFixture({ id: "task-1", title: "Loaded task" })];
    snapshot.isLoadingTasks = false;
    h.rerender(<TaskDetailsSheetViewer taskId="task-1" onOpenChange={() => {}} />);
    await waitFor(() => expect(h.getByRole("dialog", { name: "Loaded task" })).toBeTruthy(), {
      timeout: 700,
    });
    expect(h.queryClient.getQueryState(taskQueryKeys.repoData("/repo-a"))?.fetchStatus).toBe(
      "idle",
    );
  } finally {
    h.dispose();
  }
});

test("uses a task already in context without a task-list request", () => {
  const h = createHarness({
    tasks: [createTaskCardFixture({ id: "task-1", title: "Cached task" })],
    isLoadingTasks: false,
  });
  try {
    expect(h.getByRole("dialog", { name: "Cached task" })).toBeTruthy();
    expect(h.queryByRole("status", { name: "Loading task details" })).toBeNull();
    expect(h.queryClient.isFetching({ queryKey: taskQueryKeys.all })).toBe(0);
  } finally {
    h.dispose();
  }
});

test("keeps the skeleton open until the shared task query resolves", async () => {
  const pending = Promise.withResolvers<RepoTaskData>();
  const h = createHarness({ tasks: [], isLoadingTasks: false }, (client) => {
    void client.fetchQuery({
      queryKey: taskQueryKeys.repoData("/repo-a"),
      queryFn: () => pending.promise,
    });
  });
  try {
    expect(h.getByRole("dialog").querySelector('[data-slot="skeleton"]')).not.toBeNull();
    await act(async () => {
      pending.resolve({ tasks: [createTaskCardFixture({ id: "task-1", title: "Fetched task" })] });
    });
    await waitFor(() => expect(h.getByRole("dialog", { name: "Fetched task" })).toBeTruthy(), {
      timeout: 700,
    });
    expect(h.queryByRole("status", { name: "Loading task details" })).toBeNull();
  } finally {
    h.dispose();
  }
});

test.each(["failure", "missing"])(
  "shows %s inside the sheet instead of an endless skeleton",
  async (result) => {
    const pending = Promise.withResolvers<RepoTaskData>();
    const h = createHarness({ tasks: [], isLoadingTasks: false }, (client) => {
      void client
        .fetchQuery({
          queryKey: taskQueryKeys.repoData("/repo-a"),
          queryFn: () => pending.promise,
        })
        .catch(() => {});
    });
    try {
      await act(async () => {
        if (result === "failure") pending.reject(new Error("Task store unavailable"));
        else pending.resolve({ tasks: [] });
      });
      await waitFor(
        () =>
          expect(h.getByRole("alert").textContent).toContain(
            result === "failure" ? "Task store unavailable" : "no longer exists",
          ),
        { timeout: 700 },
      );
      expect(h.getByRole("dialog").contains(h.getByRole("alert"))).toBe(true);
      expect(
        within(h.getByRole("alert")).getByRole("heading", { name: "Task details unavailable" }),
      ).toBeTruthy();
      expect(h.getByRole("dialog").textContent).not.toContain("your chat");
      expect(h.getByRole("alert").classList.contains("bg-destructive-surface")).toBe(true);
      expect(h.getByRole("alert").classList.contains("border-destructive-border")).toBe(true);
      expect(h.getByRole("alert").classList.contains("m-auto")).toBe(true);
      expect(h.queryByRole("status")).toBeNull();
      fireEvent.click(h.getByRole("button", { name: "Close" }));
      expect(h.closed).toEqual([false]);
    } finally {
      h.dispose();
    }
  },
);

test("Open shows a sheet during lazy loading and closing it keeps it closed", async () => {
  const task = {
    id: "task-1",
    title: "Chat-created task",
    description: "Task description",
    status: "open",
    priority: 2,
    issueType: "task",
    labels: [],
    aiReviewEnabled: true,
    createdAt: "2026-09-09T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z",
    qaVerdict: "not_reviewed",
    documents: { hasSpec: false, hasPlan: false, hasQaReport: false },
  };
  const h = render(
    <AgentChatTaskTool
      tool="create_task"
      timeLabel="now"
      messageContent=""
      messageTimestamp="2026-09-09T10:00:00Z"
      meta={{
        kind: "tool",
        partId: "p1",
        callId: "c1",
        tool: "odt_create_task",
        toolType: "generic",
        status: "completed",
        output: JSON.stringify({ task }),
      }}
    />,
  );
  try {
    fireEvent.click(h.getByRole("button", { name: "Open task details" }));
    const dialog = h.getByRole("dialog", { name: "Task Details" });
    expect(within(dialog).getByRole("status", { name: "Loading task details" })).toBeTruthy();
    expect(h.container.textContent).not.toContain("Loading task details");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await act(async () => {});
    expect(h.queryByRole("dialog")).toBeNull();
  } finally {
    h.unmount();
  }
});
