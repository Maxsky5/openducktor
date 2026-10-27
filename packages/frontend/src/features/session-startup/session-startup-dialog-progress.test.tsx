import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, renderHook, waitFor, within } from "@testing-library/react";
import { type PropsWithChildren, useEffect, useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import type { StartupScope, WorkspaceSession } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  adoptStartupPreparedHandoff,
  observeStartupPreparation,
  registerStartupLiveSource,
} from "@openducktor/frontend-core/sessions/startup/startup-prepared-handoff";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  WorkspacePreviewTransitionGuardProvider,
  useWorkspacePreviewTransitionGuard,
} from "@/components/layout/workspace-preview-transition-guard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StartupDialogProgress } from "./session-startup-dialog-progress";
import { AppToaster, StartupNotifications } from "./session-startup-stack";
import { useOpenStartupSession } from "./use-open-startup-session";

test.each([
  ["workspace", "failed"],
  ["workspace", "canceled"],
  ["workspace", "ready"],
  ["task", "failed"],
  ["task", "canceled"],
  ["task", "ready"],
] as const)(
  "Open %s worktree session closes its %s dialog and retains only unsuccessful feedback",
  async (kind, phase) => {
    const mutation = mock(async () => {
      throw new Error("Opening a saved session must not start work.");
    });
    const connection = createTestClientConnection({
      client: {
        workspaceSessionCreate: mutation,
        workspaceSessionStart: mutation,
        agentSessionControlResume: mutation,
      },
    });
    const workspace = createWorkspaceRecordFixture({
      workspaceId: "origin",
      workspaceName: "Origin",
      repoPath: "/origin",
    });
    const session: WorkspaceSession = {
      id: "saved-session",
      runtimeKind: "codex",
      externalSessionId: "native-session",
      executionTarget: {
        kind: "local_worktree",
        workingDirectory: "/origin/worktree",
        branchName: "odt/saved",
        worktreeState: "present",
      },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      targetBranch: null,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    };
    const ref = {
      repoPath: workspace.repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: "/origin/worktree",
      externalSessionId: "native-session",
    };
    const scope: StartupScope =
      kind === "workspace"
        ? { kind: "workspace" }
        : { kind: "task", taskId: "saved-task", role: "build" };
    const taskRecord = {
      ...ref,
      role: "build" as const,
      startedAt: "2026-10-26T00:00:00.000Z",
      selectedModel: null,
    };
    const release = registerStartupLiveSource(connection.queryClient, {
      observeWorkspace: () => () => {},
      observeAgentSessionLive: async (_input, listener) => {
        listener({
          type: "session_upsert",
          sequence: 1,
          session: {
            ref,
            activity: "idle",
            title: "Saved session",
            startedAt: "2026-10-26T00:00:00.000Z",
            pendingApprovals: [],
            pendingQuestions: [],
            contextUsage: null,
          },
        });
        return () => {};
      },
    });
    const id = connection.startupAttempts.begin({
      origin: {
        workspaceId: workspace.workspaceId,
        repoPath: workspace.repoPath,
        scope,
      },
      label: "Saved session",
      presentation: "dialog",
    });
    await observeStartupPreparation(connection.queryClient, workspace.repoPath, id);
    const outcome = await connection.startupAttempts.operation(id, async (context) => ({
      startupProgress: {
        context,
        hostInstanceId: "host",
        revision: 1,
        workspaceId: workspace.workspaceId,
        repoPath: workspace.repoPath,
        scope,
        phase: phase === "ready" ? ("completed" as const) : phase,
        ownership: {
          state: "saved" as const,
          target:
            kind === "workspace"
              ? { kind: "workspace" as const, record: session }
              : { kind: "task" as const, record: taskRecord },
        },
        prepared: { ref, runtimeId: "runtime", liveStateSequence: 1 },
        steps: [
          {
            id: "checkout",
            label: "Create worktree",
            state: "completed" as const,
            details: ["Created /origin/worktree on branch odt/saved."],
          },
          {
            id: "copies",
            label: "Copy configured files",
            state: "completed" as const,
            details: [],
          },
        ],
      },
    }));
    await adoptStartupPreparedHandoff(connection.queryClient, outcome.startupProgress);
    const retry = mock(async () => {});
    if (phase === "ready") await connection.startupAttempts.complete(id);
    else {
      if (kind === "task") connection.startupAttempts.setInstruction(id, { state: "not_sent" });
      connection.startupAttempts.setRecoveryActions(id, [
        {
          kind: kind === "task" ? "retry_message" : "repair",
          label: kind === "task" ? "Retry message" : "Retry session preparation",
          run: retry,
        },
      ]);
    }
    const original = connection.startupAttempts.getAttempt(id);
    const closed = mock(() => {});
    function Harness() {
      const [open, setOpen] = useState(true);
      const location = useLocation();
      return (
        <>
          <output aria-label="Current location">
            {location.pathname}
            {location.search}
          </output>
          <AppToaster />
          <StartupNotifications />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Startup</DialogTitle>
              </DialogHeader>
              <StartupDialogProgress
                open={open}
                startupAttemptId={id}
                onClose={() => {
                  closed();
                  setOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>
        </>
      );
    }
    const view = render(
      <MemoryRouter initialEntries={["/kanban"]}>
        <QueryProvider connection={connection}>
          <WorkspaceStateContext
            value={createWorkspaceStateFixture({
              activeWorkspace: workspace,
              workspaces: [workspace],
            })}
          >
            <WorkspacePreviewTransitionGuardProvider>
              <Harness />
            </WorkspacePreviewTransitionGuardProvider>
          </WorkspaceStateContext>
        </QueryProvider>
      </MemoryRouter>,
    );
    try {
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Open session" }));
      });
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull(), { timeout: 800 });
      expect(view.getByLabelText("Current location").textContent).toBe(
        kind === "workspace"
          ? "/sessions?workspace=origin&kind=workspace&session=saved-session"
          : "/sessions?workspace=origin&kind=task&task=saved-task&session=native-session&agent=build",
      );
      expect(closed).toHaveBeenCalledTimes(1);
      if (phase === "ready") {
        expect(connection.startupAttempts.getAttempt(id)).toBeNull();
        const notifications = within(view.getByRole("region", { name: /^Notifications/ }));
        expect(
          notifications.queryByText(
            kind === "workspace" ? "origin · Workspace chat" : "origin · saved-task",
          ),
        ).toBeNull();
      } else {
        const retained = connection.startupAttempts.getAttempt(id);
        expect(retained).toMatchObject({ id, presentation: "notification", status: { phase } });
        expect(retained?.operations).toEqual(original?.operations);
        if (kind === "task") expect(retained?.instruction?.state).toBe("not_sent");
        expect(await view.findByRole("region", { name: /^Notifications/ })).toBeDefined();
        const steps = await view.findByRole("list", { name: "Session startup steps" });
        const toast = steps.closest<HTMLElement>("[data-sonner-toast]");
        if (!toast) throw new Error("The startup notification is missing.");
        const notification = within(toast);
        expect(notification.getByText("Create worktree")).toBeDefined();
        expect(retry).not.toHaveBeenCalled();
        const open = notification.getByRole("button", { name: "Open" });
        expect(open.hasAttribute("data-action")).toBe(true);
        expect(notification.queryByRole("button", { name: "Open session" })).toBeNull();
        await act(async () => {
          fireEvent.click(open);
        });
        expect(connection.startupAttempts.getAttempt(id)).toEqual(retained);
        expect(toast.getAttribute("data-removed")).not.toBe("true");
        await act(async () => {
          fireEvent.click(
            notification.getByRole("button", {
              name: kind === "task" ? "Retry message" : "Retry session preparation",
            }),
          );
        });
        expect(retry).toHaveBeenCalledTimes(1);
        expect(mutation).not.toHaveBeenCalled();
        fireEvent.click(notification.getByRole("button", { name: "Close toast" }));
        expect(connection.startupAttempts.getAttempt(id)).toBeNull();
      }
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      release();
      await connection.dispose();
    }
  },
);

type PendingStartupNavigation = { apply?: () => void | Promise<void | boolean> };

test("queued Open rechecks the current attempt before leaving the transition guard", async () => {
  const connection = createTestClientConnection();
  const workspace = createWorkspaceRecordFixture({ workspaceId: "origin", repoPath: "/origin" });
  const id = connection.startupAttempts.begin({
    origin: {
      workspaceId: workspace.workspaceId,
      repoPath: workspace.repoPath,
      scope: { kind: "workspace" },
    },
    label: "Saved session",
    presentation: "notification",
  });
  connection.startupAttempts.setSaved(id, {
    state: "saved",
    target: {
      kind: "workspace",
      record: {
        id: "saved",
        runtimeKind: "codex",
        externalSessionId: "native-saved",
        executionTarget: { kind: "local_repo_root", workingDirectory: "/origin" },
        roleSnapshot: null,
        selectedModel: null,
        generatedTitle: null,
        manualTitle: null,
        targetBranch: null,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
      },
    },
  });
  connection.startupAttempts.fail(id, "Session preparation failed. Retry the saved session.");
  const initial = connection.startupAttempts.getAttempt(id);
  const command = Promise.withResolvers<{}>();
  const transition: PendingStartupNavigation = {};
  let operation: Promise<{}> | null = null;
  const wrapper = ({ children }: PropsWithChildren) => (
    <MemoryRouter initialEntries={["/kanban"]}>
      <QueryProvider connection={connection}>
        <WorkspaceStateContext
          value={createWorkspaceStateFixture({
            workspaces: [workspace],
            activeWorkspace: workspace,
          })}
        >
          <WorkspacePreviewTransitionGuardProvider>
            {children}
          </WorkspacePreviewTransitionGuardProvider>
        </WorkspaceStateContext>
      </QueryProvider>
    </MemoryRouter>
  );
  const view = renderHook(
    () => {
      const guard = useWorkspacePreviewTransitionGuard();
      useEffect(
        () =>
          guard.register((apply) => {
            transition.apply = apply;
          }),
        [guard],
      );
      const navigation = useOpenStartupSession(initial);
      const location = useLocation();
      return { ...navigation, href: `${location.pathname}${location.search}` };
    },
    { wrapper },
  );
  try {
    const opened = view.result.current.openSession();
    await act(async () => {
      operation = connection.startupAttempts.operation(id, async () => command.promise);
    });
    expect(connection.startupAttempts.getAttempt(id)?.status.phase).toBe("submitting");
    const apply = transition.apply;
    if (!apply) throw new Error("The navigation transition was not guarded.");
    await act(async () => {
      await apply();
    });
    const didOpen = await opened;
    expect(didOpen).toBe(false);
    expect(view.result.current.href).toBe("/kanban");
    expect(connection.startupAttempts.getAttempt(id)).not.toBeNull();
  } finally {
    await act(async () => {
      command.resolve({});
      await operation;
    });
    view.unmount();
    await connection.dispose();
  }
});
