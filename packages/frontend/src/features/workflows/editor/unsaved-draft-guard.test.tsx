import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { newWorkflowDocument } from "@openducktor/workflows";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import {
  WorkspacePreviewRouteGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { workflowPath } from "../workflow-routes";
import { createEditorStore } from "./model/editor-store";
import { UnsavedDraftGuard } from "./unsaved-draft-guard";

const renderEditorRoute = () => {
  let failSave: (cause: Error) => void = () => {};
  let finishSave: () => void = () => {};
  const store = createEditorStore(
    {
      workflowId: "flow",
      document: newWorkflowDocument("flow", "Flow"),
      readOnly: false,
      hasDraft: true,
      viewPositions: {},
    },
    {
      saveDraft: () =>
        new Promise((resolve, reject) => {
          failSave = reject;
          finishSave = () => resolve({ workflowId: "flow" });
        }),
    },
  );
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <WorkspacePreviewTransitionGuardProvider>
            <WorkspacePreviewRouteGuard />
            <UnsavedDraftGuard store={store} />
            <Link to="/kanban">Open Kanban</Link>
            <Outlet />
          </WorkspacePreviewTransitionGuardProvider>
        ),
        children: [
          { path: "workflows/flow", element: <p>Editor</p> },
          { path: "kanban", element: <p>Kanban</p> },
        ],
      },
    ],
    { initialEntries: [workflowPath("flow")] },
  );
  render(<RouterProvider router={router} />);
  return {
    store,
    failSave: (cause: Error) => failSave(cause),
    finishSave: () => finishSave(),
  };
};

test("asks before leaving while a draft save failed, and leaves on confirm", async () => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  try {
    const { store, failSave } = renderEditorRoute();
    await act(async () => {
      store.getState().change((document) => ({
        ...document,
        definition: { ...document.definition, label: "Renamed" },
      }));
      store.getState().flushSave();
      failSave(new Error("Host is offline."));
    });
    await waitFor(() => expect(store.getState().save.status).toBe("failed"));

    fireEvent.click(screen.getByText("Open Kanban"));
    expect(await screen.findByText(/It did not save: Host is offline\./)).toBeTruthy();
    expect(screen.getByText("Editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Kanban")).toBeTruthy();
  } finally {
    console.warn = warn;
  }
  // The editor asks through the app route guard, so the router keeps one blocker.
  expect(warnings.filter((text) => text.includes("one blocker"))).toEqual([]);
});

test("waits for the last edit to save, then leaves without a question", async () => {
  const { store, finishSave } = renderEditorRoute();
  act(() =>
    store.getState().change((document) => ({
      ...document,
      definition: { ...document.definition, label: "Renamed" },
    })),
  );
  fireEvent.click(screen.getByText("Open Kanban"));
  // The click starts the save at once, and the route waits for it.
  expect(screen.getByText("Editor")).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(async () => finishSave());
  expect(await screen.findByText("Kanban")).toBeTruthy();
});

test("leaves without a question when every change is saved", async () => {
  renderEditorRoute();
  fireEvent.click(screen.getByText("Open Kanban"));
  expect(await screen.findByText("Kanban")).toBeTruthy();
});
