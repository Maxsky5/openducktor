import { expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { useTaskExecutionFilePreviewController } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewRouteGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { AgentActivityCard } from "./agent-activity-card";

const taskSession = {
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  taskId: "task-1",
  taskTitle: "Add SSO",
  role: "build" as const,
  activityState: "starting" as const,
  startedAt: "2026-02-26T10:00:00.000Z",
};

function PreviewPage() {
  const { register } = useWorkspacePreviewTransitionGuard();
  const preview = useTaskExecutionFilePreviewController({
    rootPath: "/repo",
    relativePath: "draft.txt",
  });
  useEffect(
    () => register((apply, cancel) => preview.requestContextTransition(apply, cancel)),
    [preview, register],
  );
  return (
    <div>
      <p>Chat preview</p>
      <button type="button" onClick={() => preview.model.onLeavePolicyChange("confirm")}>
        Make dirty
      </button>
      <button type="button" onClick={() => preview.model.onLeavePolicyChange("defer")}>
        Start save
      </button>
      <button type="button" onClick={() => preview.model.onLeavePolicyChange("allow")}>
        Finish save
      </button>
      {preview.model.hasPendingDiscard ? (
        <div role="dialog" aria-label="Unsaved edits">
          <button type="button" onClick={preview.model.onKeepEditing}>
            Keep editing
          </button>
          <button type="button" onClick={preview.model.onDiscard}>
            Discard edits
          </button>
        </div>
      ) : null}
    </div>
  );
}

function renderActivityLink() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <WorkspacePreviewTransitionGuardProvider>
            <WorkspacePreviewRouteGuard />
            <AgentActivityCard
              activeSessionCount={1}
              waitingForInputCount={0}
              activeSessions={[taskSession]}
              waitingForInputSessions={[]}
            />
            <Outlet />
          </WorkspacePreviewTransitionGuardProvider>
        ),
        children: [
          { path: "chats", element: <PreviewPage /> },
          { path: "workflows", element: <p>Task workflow</p> },
        ],
      },
    ],
    { initialEntries: ["/chats?session=chat-1"] },
  );
  const view = render(<RouterProvider router={router} useTransitions={false} />);
  return { ...view, router };
}

test("task activity link keeps the dirty chat preview until the user discards it", async () => {
  const view = renderActivityLink();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Make dirty" }));
    fireEvent.click(screen.getByRole("link", { name: /Add SSO/ }));
    await screen.findByRole("dialog", { name: "Unsaved edits" });
    expect(view.router.state.location.pathname).toBe("/chats");

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved edits" })).toBeNull());
    expect(view.router.state.location.pathname).toBe("/chats");

    fireEvent.click(screen.getByRole("link", { name: /Add SSO/ }));
    await screen.findByRole("dialog", { name: "Unsaved edits" });
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    await screen.findByText("Task workflow");
    expect(view.router.state.location.pathname).toBe("/workflows");
  } finally {
    view.unmount();
    view.router.dispose();
  }
});

test("task activity link waits for a preview save before leaving the chat", async () => {
  const view = renderActivityLink();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Start save" }));
    fireEvent.click(screen.getByRole("link", { name: /Add SSO/ }));
    expect(view.router.state.location.pathname).toBe("/chats");
    expect(screen.getByText("Chat preview")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Unsaved edits" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Finish save" }));
    await screen.findByText("Task workflow");
    expect(view.router.state.location.pathname).toBe("/workflows");
  } finally {
    view.unmount();
    view.router.dispose();
  }
});
