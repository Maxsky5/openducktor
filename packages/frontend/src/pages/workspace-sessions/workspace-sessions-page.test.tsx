import { expect, spyOn, test } from "bun:test";
import { render } from "@testing-library/react";
import * as diffWorkers from "@/contexts/DiffWorkerProvider";
import { ActiveWorkspaceContext } from "@/state/app-state-contexts";
import WorkspaceSessionsPage from "./workspace-sessions-page";
import * as workspaceSessionsView from "./workspace-sessions-view";

test("repository sessions mount the syntax worker provider around the view", () => {
  const provider = spyOn(diffWorkers, "DiffWorkerProvider").mockImplementation(({ children }) => (
    <div data-testid="syntax-worker-provider">{children}</div>
  ));
  const sessions = spyOn(workspaceSessionsView, "WorkspaceSessions").mockImplementation(() => (
    <div data-testid="repository-session-view">Edited /home/user/.claude/memory/MEMORY.md</div>
  ));
  let view: ReturnType<typeof render> | undefined;
  try {
    view = render(
      <ActiveWorkspaceContext
        value={{
          activeWorkspace: { workspaceId: "workspace", workspaceName: "A", repoPath: "/repo" },
          setActiveWorkspace: () => {},
        }}
      >
        <WorkspaceSessionsPage />
      </ActiveWorkspaceContext>,
    );
    expect(
      view
        .getByTestId("syntax-worker-provider")
        .contains(view.getByTestId("repository-session-view")),
    ).toBe(true);
  } finally {
    view?.unmount();
    sessions.mockRestore();
    provider.mockRestore();
  }
});
