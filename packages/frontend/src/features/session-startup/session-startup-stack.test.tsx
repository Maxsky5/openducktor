import { expect, test } from "bun:test";
import type { StartupOperationSnapshot } from "@openducktor/contracts";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { QueryProvider } from "@/test-utils/query-provider";
import { createWorkspaceStateFixture } from "@/test-utils/shared-test-fixtures";
import { StartupNotifications } from "./session-startup-stack";

test("keeps background starts visible, worktree progress inspectable, and only settled attempts dismissible", async () => {
  const connection = createTestClientConnection();
  const attemptIds = Array.from({ length: 6 }, (_, index) =>
    connection.startupAttempts.begin({
      origin: {
        workspaceId: "workspace",
        repoPath: "/repo",
        scope: { kind: "task", taskId: `task-${index}`, role: "build" },
      },
      label: `Background start ${index}`,
      presentation: "notification",
    }),
  );
  const firstId = attemptIds[0];
  const cleanupId = attemptIds[1];
  if (!firstId || !cleanupId) throw new Error("A startup attempt is missing.");
  await connection.startupAttempts.operation(firstId, async (context) => {
    const startupProgress: StartupOperationSnapshot = {
      context,
      hostInstanceId: "host",
      revision: 1,
      workspaceId: "workspace",
      repoPath: "/repo",
      scope: { kind: "task", taskId: "task-0", role: "build" },
      phase: "running",
      ownership: { state: "not_saved" },
      steps: [
        { id: "checkout", label: "Create worktree", state: "running", details: [] },
        { id: "copies", label: "Copy configured files", state: "pending", details: [] },
      ],
    };
    return { startupProgress };
  });
  const view = render(
    <MemoryRouter>
      <QueryProvider connection={connection}>
        <WorkspaceStateContext value={createWorkspaceStateFixture()}>
          <WorkspacePreviewTransitionGuardProvider>
            <Toaster />
            <StartupNotifications />
          </WorkspacePreviewTransitionGuardProvider>
        </WorkspaceStateContext>
      </QueryProvider>
    </MemoryRouter>,
  );
  let ordinaryToastId: string | number | undefined;
  try {
    act(() => {
      ordinaryToastId = toast("Ordinary notification", { duration: Infinity });
    });
    const notifications = within(
      await view.findByRole("region", { name: "Session startup notifications" }),
    );
    await waitFor(() => expect(notifications.getAllByText(/^repo · task-\d$/)).toHaveLength(6));
    expect(notifications.getAllByRole("button", { name: "View progress" })).toHaveLength(1);
    expect(notifications.queryByRole("button", { name: "Close toast" })).toBeNull();
    expect(notifications.queryByText("Ordinary notification")).toBeNull();
    expect(await view.findByText("Ordinary notification")).toBeDefined();

    await act(async () => {
      await connection.startupAttempts.operation(cleanupId, async (context) => {
        const startupProgress: StartupOperationSnapshot = {
          context,
          hostInstanceId: "host",
          revision: 1,
          workspaceId: "workspace",
          repoPath: "/repo",
          scope: { kind: "task", taskId: "task-1", role: "build" },
          phase: "failed",
          ownership: { state: "not_saved" },
          steps: [
            {
              id: "cleanup",
              label: "Stop unused native fork",
              state: "failed",
              details: ["Keep this checkout until Stop succeeds."],
              failure: {
                stage: "cleanup",
                code: "stop_failed",
                message: "Stop unused native fork failed.",
                nextAction: "Stop the native session before removing this checkout.",
              },
              resources: [
                {
                  kind: "worktree",
                  state: "retained",
                  value: "/repo/retained-checkout",
                  nextAction: "Stop the native session before removing this checkout.",
                },
              ],
            },
          ],
        };
        return { startupProgress };
      });
    });
    const cleanupNotice = notifications.getByText("repo · task-1").closest("[data-sonner-toast]");
    if (!(cleanupNotice instanceof HTMLElement)) throw new Error("The cleanup notice is missing.");
    const cleanup = within(cleanupNotice);
    expect(cleanup.queryByRole("button", { name: "View progress" })).toBeNull();
    expect((await cleanup.findByRole("alert")).textContent).toContain(
      "Stop unused native fork failed.",
    );
    fireEvent.click(cleanup.getByRole("button", { name: "Details" }));
    expect(await cleanup.findByText("Keep this checkout until Stop succeeds.")).toBeDefined();
    expect(cleanup.getByText("/repo/retained-checkout")).toBeDefined();
    expect(
      cleanup.getAllByText("Stop the native session before removing this checkout.").length,
    ).toBeGreaterThan(0);
    expect(cleanup.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    expect(connection.startupAttempts.getSnapshot()).toHaveLength(6);

    const firstNotice = notifications.getByText("repo · task-0").closest("[data-sonner-toast]");
    if (!(firstNotice instanceof HTMLElement)) throw new Error("The startup notice is missing.");
    const first = within(firstNotice);
    fireEvent.click(first.getByRole("button", { name: "View progress" }));
    await first.findByRole("list", { name: "Session startup steps" });
    act(() => {
      connection.startupAttempts.fail(firstId, "Runtime refused the start. Check its settings.");
      connection.startupAttempts.setRecoveryActions(firstId, [
        {
          kind: "repair",
          label: "Retry session preparation",
          run: async () => {
            throw new Error("Preparation repair was refused. Correct its settings.");
          },
        },
      ]);
    });
    expect((await first.findByRole("alert")).textContent).toContain("Check its settings");
    expect(first.getByRole("button", { name: "Hide progress" })).toBeDefined();
    expect(first.getByRole("list", { name: "Session startup steps" })).toBeDefined();
    expect(connection.startupAttempts.getSnapshot()).toHaveLength(6);
    fireEvent.click(first.getByRole("button", { name: "Hide progress" }));
    await first.findByRole("button", { name: "View progress" });
    fireEvent.click(await first.findByRole("button", { name: "Retry session preparation" }));
    expect(
      await first.findByText("Preparation repair was refused. Correct its settings."),
    ).toBeDefined();
    expect(connection.startupAttempts.getSnapshot()).toHaveLength(6);
    fireEvent.click(first.getByRole("button", { name: "Close toast" }));
    expect(connection.startupAttempts.getAttempt(firstId)).toBeNull();
    await waitFor(() => expect(notifications.getAllByText(/^repo · task-\d$/)).toHaveLength(5));
    expect(notifications.queryByRole("button", { name: "View progress" })).toBeNull();
    expect(view.getByText("Ordinary notification")).toBeDefined();

    await act(async () => {
      await connection.dispose();
    });
    expect(view.queryByRole("region", { name: "Session startup notifications" })).toBeNull();
    expect(view.getByText("Ordinary notification")).toBeDefined();
  } finally {
    view.unmount();
    if (ordinaryToastId !== undefined) act(() => toast.dismiss(ordinaryToastId));
    await connection.dispose();
  }
});
