import { expect, test } from "bun:test";
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

test("keeps each background start inspectable through updates and dismisses only settled attempts", async () => {
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
  if (!firstId) throw new Error("The first startup attempt is missing.");
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
    await waitFor(() =>
      expect(notifications.getAllByRole("button", { name: "View progress" })).toHaveLength(6),
    );
    expect(notifications.queryByRole("button", { name: "Close toast" })).toBeNull();
    expect(notifications.queryByText("Ordinary notification")).toBeNull();
    expect(await view.findByText("Ordinary notification")).toBeDefined();

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
    await waitFor(() =>
      expect(notifications.getAllByRole("button", { name: "View progress" })).toHaveLength(5),
    );
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
