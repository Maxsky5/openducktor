import { expect, spyOn, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import * as taskCreate from "@/components/features/task-create/task-create-modal";
import * as chatCreate from "@/pages/workspace-sessions/workspace-session-create-dialog";
import { ActiveWorkspaceContext, TasksStateContext } from "@/state/app-state-contexts";
import type { TasksStateContextValue } from "@/types/state-slices";
import WorkspaceCreateActions from "./workspace-create-actions";

function RoutePath() {
  const location = useLocation();
  return (
    <output aria-label="Current route">
      {location.pathname}
      {location.search}
    </output>
  );
}

function ChatCreationProbe(props: Parameters<typeof chatCreate.WorkspaceSessionCreateDialog>[0]) {
  const [name, setName] = useState("");
  return (
    <div role="dialog" aria-label="Chat creation" data-state={props.open ? "open" : "closed"}>
      <input
        aria-label="Chat name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="button" onClick={props.onClose}>
        Cancel chat
      </button>
      <button
        type="button"
        onClick={() =>
          props.onCreated({
            id: "created-session",
            runtimeKind: "codex",
            externalSessionId: null,
            executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
            roleSnapshot: null,
            selectedModel: null,
            generatedTitle: null,
            manualTitle: "New session",
            createdAt: 1000,
            updatedAt: 1000,
            archivedAt: null,
          })
        }
      >
        Finish creation
      </button>
    </div>
  );
}

test("closed creation actions do not subscribe to task state", () => {
  const view = render(
    <MemoryRouter>
      <ActiveWorkspaceContext
        value={{
          activeWorkspace: { workspaceId: "A", workspaceName: "A", repoPath: "/repo" },
          setActiveWorkspace: () => {},
        }}
      >
        <WorkspaceCreateActions compact={false} />
      </ActiveWorkspaceContext>
    </MemoryRouter>,
  );
  try {
    expect(view.getByRole("button", { name: "New task" })).toBeTruthy();
    expect(view.queryByRole("dialog")).toBeNull();
  } finally {
    view.unmount();
  }
});

test.each([false, true])(
  "sidebar actions open task and chat dialogs without changing the route, compact=%s",
  (compact) => {
    const tasks: TasksStateContextValue = {
      tasks: [],
      tasksAreCurrent: true,
      isForegroundLoadingTasks: false,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: false,
      detectingPullRequestTaskId: null,
      linkingMergedPullRequestTaskId: null,
      unlinkingPullRequestTaskId: null,
      pendingMergedPullRequest: null,
      refreshTasks: async () => {},
      syncPullRequests: async () => {},
      linkMergedPullRequest: async () => {},
      cancelLinkMergedPullRequest: () => {},
      unlinkPullRequest: async () => {},
      createTask: async () => {},
      updateTask: async () => {},
      setTaskTargetBranch: async () => {},
      deleteTask: async () => {},
      closeTask: async () => {},
      resetTaskImplementation: async () => {},
      resetTask: async () => {},
      transitionTask: async () => {},
      humanApproveTask: async () => {},
      humanRequestChangesTask: async () => {},
    };
    const modal = spyOn(taskCreate, "TaskCreateModal").mockImplementation((props) => {
      expect(props.tasks).toBe(tasks.tasks);
      return (
        <div role="dialog" aria-label="Task creation" data-state={props.open ? "open" : "closed"}>
          <button type="button" onClick={() => props.onOpenChange(false)}>
            Cancel task
          </button>
        </div>
      );
    });
    const chatModal = spyOn(chatCreate, "WorkspaceSessionCreateDialog").mockImplementation(
      (props) => <ChatCreationProbe {...props} />,
    );
    const view = render(
      <MemoryRouter initialEntries={["/workflows?task=example"]}>
        <ActiveWorkspaceContext
          value={{
            activeWorkspace: { workspaceId: "A", workspaceName: "A", repoPath: "/repo" },
            setActiveWorkspace: () => {},
          }}
        >
          <TasksStateContext value={tasks}>
            <WorkspaceCreateActions compact={compact} />
            <RoutePath />
          </TasksStateContext>
        </ActiveWorkspaceContext>
      </MemoryRouter>,
    );
    try {
      const newTask = view.getByRole("button", { name: "New task" });
      expect(newTask.querySelectorAll("svg")).toHaveLength(1);
      expect(newTask.querySelector("svg.lucide-plus")).not.toBeNull();
      if (!compact) expect(newTask.className).toContain("text-sm");
      fireEvent.click(newTask);
      expect(view.queryByRole("dialog", { name: "Task creation" }) !== null).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Cancel task" }));
      expect(view.getByRole("dialog", { name: "Task creation" }).getAttribute("data-state")).toBe(
        "closed",
      );
      fireEvent.click(view.getByRole("button", { name: "New chat" }));
      expect(view.getByRole("dialog", { name: "Chat creation" })).toBeTruthy();
      expect(view.getByLabelText("Current route").textContent).toBe("/workflows?task=example");
      fireEvent.change(view.getByRole("textbox", { name: "Chat name" }), {
        target: { value: "Cancelled choice" },
      });
      fireEvent.click(view.getByRole("button", { name: "Cancel chat" }));
      expect(view.getByRole("dialog", { name: "Chat creation" }).getAttribute("data-state")).toBe(
        "closed",
      );
      expect(view.getByLabelText("Current route").textContent).toBe("/workflows?task=example");
      fireEvent.click(view.getByRole("button", { name: "New chat" }));
      const chatName = view.getByRole("textbox", { name: "Chat name" });
      if (!(chatName instanceof HTMLInputElement)) throw new Error("Chat name is not an input");
      expect(chatName.value).toBe("");
      fireEvent.click(view.getByRole("button", { name: "Finish creation" }));
      expect(view.getByRole("dialog", { name: "Chat creation" }).getAttribute("data-state")).toBe(
        "closed",
      );
      expect(view.getByLabelText("Current route").textContent).toBe(
        "/chats?session=created-session",
      );
    } finally {
      view.unmount();
      modal.mockRestore();
      chatModal.mockRestore();
    }
  },
);
