import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createMemoryRouter, Outlet, RouterProvider, useNavigate } from "react-router";
import { useTaskExecutionFilePreviewController } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewRouteGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "./workspace-preview-transition-guard";

function PreviewPage() {
  const { register, run } = useWorkspacePreviewTransitionGuard();
  const navigate = useNavigate();
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
      <button type="button" onClick={() => run(() => navigate("/kanban"))}>
        Open Kanban
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

function renderHistoryExit() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <WorkspacePreviewTransitionGuardProvider>
            <WorkspacePreviewRouteGuard />
            <Outlet />
          </WorkspacePreviewTransitionGuardProvider>
        ),
        children: [
          { path: "chats", element: <PreviewPage /> },
          { path: "kanban", element: <p>Kanban page</p> },
        ],
      },
    ],
    { initialEntries: ["/kanban", "/chats"], initialIndex: 1 },
  );
  const view = render(<RouterProvider router={router} useTransitions={false} />);
  return { ...view, router };
}

test("history exit keeps a dirty preview when editing continues and leaves after discard", async () => {
  const view = renderHistoryExit();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Make dirty" }));
    void view.router.navigate(-1);
    await screen.findByRole("dialog", { name: "Unsaved edits" });
    expect(view.router.state.location.pathname).toBe("/chats");

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved edits" })).toBeNull());
    expect(view.router.state.location.pathname).toBe("/chats");

    void view.router.navigate(-1);
    await screen.findByRole("dialog", { name: "Unsaved edits" });
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    await screen.findByText("Kanban page");
  } finally {
    view.unmount();
    view.router.dispose();
  }
});

test("a guarded click replaces a blocked history exit", async () => {
  const view = renderHistoryExit();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Make dirty" }));
    void view.router.navigate(-1);
    await screen.findByRole("dialog", { name: "Unsaved edits" });

    fireEvent.click(screen.getByRole("button", { name: "Open Kanban" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    await waitFor(() =>
      expect(
        [...view.router.state.blockers.values()].some((blocker) => blocker.state === "blocked"),
      ).toBe(false),
    );
    expect(view.router.state.location.pathname).toBe("/chats");
    void view.router.navigate(-1);
    await screen.findByRole("dialog", { name: "Unsaved edits" });
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    await screen.findByText("Kanban page");
  } finally {
    view.unmount();
    view.router.dispose();
  }
});

test("history exit waits for a save before the preview can leave", async () => {
  const view = renderHistoryExit();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Start save" }));
    act(() => {
      void view.router.navigate(-1);
    });
    await waitFor(() =>
      expect(
        [...view.router.state.blockers.values()].some((blocker) => blocker.state === "blocked"),
      ).toBe(true),
    );
    expect(view.router.state.location.pathname).toBe("/chats");
    expect(screen.getByText("Chat preview")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish save" }));
    await screen.findByText("Kanban page");
  } finally {
    view.unmount();
    view.router.dispose();
  }
}, 5_000);

test("a failed save returns the blocked history exit to the discard choice", async () => {
  const view = renderHistoryExit();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Start save" }));
    void view.router.navigate(-1);
    await waitFor(() =>
      expect(
        [...view.router.state.blockers.values()].some((blocker) => blocker.state === "blocked"),
      ).toBe(true),
    );
    expect(view.router.state.location.pathname).toBe("/chats");

    fireEvent.click(screen.getByRole("button", { name: "Make dirty" }));
    await screen.findByRole("dialog", { name: "Unsaved edits" });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(view.router.state.location.pathname).toBe("/chats");
    expect(screen.getByText("Chat preview")).toBeTruthy();
  } finally {
    view.unmount();
    view.router.dispose();
  }
});
