import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { AgentsPage } from "@/pages/agents/agents-page";
import {
  ActiveWorkspaceContext,
  TaskSnapshotContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { SessionsPage } from "./sessions-page";

const realAgentsPage = { AgentsPage };
const workspace = createWorkspaceRecordFixture({ workspaceId: "alpha" });

function Harness({ initiallyClosed = false }: { initiallyClosed?: boolean }): ReactElement {
  const [closed, setClosed] = useState(initiallyClosed);
  const navigate = useNavigate();
  const tasks = [
    createTaskCardFixture({ id: "current", status: closed ? "closed" : "human_review" }),
    createTaskCardFixture({ id: "other", status: "closed" }),
  ];
  const workspaceState = createWorkspaceStateFixture({
    activeWorkspace: workspace,
    workspaces: [workspace],
  });
  return (
    <ActiveWorkspaceContext.Provider
      value={{ activeWorkspace: workspace, setActiveWorkspace: () => {} }}
    >
      <WorkspaceStateContext.Provider value={workspaceState}>
        <TaskSnapshotContext.Provider value={{ tasks, isLoadingTasks: false }}>
          <button type="button" onClick={() => setClosed(true)}>
            Close current task
          </button>
          <button type="button" onClick={() => navigate(-1)}>
            Back
          </button>
          <Routes>
            <Route path="/before-session" element={<p>Previous page</p>} />
            <Route path="/kanban" element={<p>Kanban board</p>} />
            <Route path="/sessions" element={<SessionsPage />} />
          </Routes>
        </TaskSnapshotContext.Provider>
      </WorkspaceStateContext.Provider>
    </ActiveWorkspaceContext.Provider>
  );
}

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
