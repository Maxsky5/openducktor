import { expect, test } from "bun:test";
import type { AgentSessionControlSummary, StartupOperationSnapshot } from "@openducktor/contracts";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { observeStartupPreparation } from "@openducktor/frontend-core/sessions/startup/startup-prepared-handoff";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { InlineStartup } from "./inline-session-startup";

async function setup({
  holdPreparedPublication = false,
  steps = [],
}: {
  holdPreparedPublication?: boolean;
  steps?: StartupOperationSnapshot["steps"];
} = {}) {
  const connection = createTestClientConnection({ scheduleTask: () => () => {} });
  const runtimeSession: AgentSessionControlSummary = {
    externalSessionId: "native-session",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
    startedAt: "2026-10-27T00:00:00.000Z",
    status: "idle",
  };
  const workspace = createWorkspaceRecordFixture({ workspaceId: "workspace", repoPath: "/repo" });
  const live = createStartupLiveSourceFake(connection.queryClient, { holdPreparedPublication });
  const origin = {
    workspaceId: "workspace",
    repoPath: "/repo",
    scope: { kind: "task" as const, taskId: "task", role: "build" },
  };
  const id = connection.startupAttempts.begin({
    origin,
    label: "Start Builder session",
    presentation: "inline",
  });
  await observeStartupPreparation(connection.queryClient, origin.repoPath, id);
  await connection.startupAttempts.operation(id, async (context) => ({
    startupProgress: {
      ...live.prepared({
        ...origin,
        context,
        ownership: {
          state: "saved",
          target: {
            kind: "task",
            runtimeSession,
            record: {
              ...runtimeSession,
              role: "build",
              selectedModel: null,
            },
          },
        },
      }),
      steps,
    },
  }));
  return {
    connection,
    id,
    live,
    render: () =>
      render(
        <MemoryRouter>
          <QueryProvider connection={connection}>
            <WorkspaceStateContext
              value={createWorkspaceStateFixture({
                activeWorkspace: workspace,
                workspaces: [workspace],
              })}
            >
              <WorkspacePreviewTransitionGuardProvider>
                <InlineStartup repoPath="/repo" taskId="task" role="build" />
              </WorkspacePreviewTransitionGuardProvider>
            </WorkspaceStateContext>
          </QueryProvider>
        </MemoryRouter>,
      ),
    dispose: async () => {
      live.dispose();
      await connection.dispose();
    },
  };
}

test("removes inline startup only after the native session and completed launch confirm handoff", async () => {
  const h = await setup({
    holdPreparedPublication: true,
    steps: [
      { id: "session", label: "Prepare native session", state: "completed", details: [] },
      { id: "handoff", label: "Prepare session handoff", state: "completed", details: [] },
    ],
  });
  const view = h.render();
  try {
    expect(view.getByRole("status").textContent).not.toBe("");
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    expect(view.queryByRole("button", { name: /View progress$/ })).toBeNull();
    expect(view.queryByText(/\d+(?: of |\/)\d+ steps/)).toBeNull();
    expect(view.queryByText("Prepare native session")).toBeNull();
    expect(view.queryByText("Prepare session handoff")).toBeNull();
    expect(h.connection.startupAttempts.isReadyForHandoff(h.id)).toBe(false);
    await act(async () => {
      h.live.publishPrepared();
    });
    expect(h.connection.startupAttempts.getAttempt(h.id)?.status.phase).toBe("ready");
    expect(h.connection.startupAttempts.isReadyForHandoff(h.id)).toBe(false);
    expect(view.container.textContent).not.toBe("");
    await act(async () => {
      await h.connection.startupAttempts.complete(h.id);
    });
    expect(view.container.textContent).toBe("");
    expect(h.connection.startupAttempts.getAttempt(h.id)).toBeNull();
  } finally {
    view.unmount();
    await h.dispose();
  }
});

test("retains a compact inspectable trace when a prepared session has an asynchronous action failure", async () => {
  const h = await setup({
    steps: [
      {
        id: "setup",
        label: "Run setup",
        state: "completed",
        details: [],
        action: {
          actionId: "setup",
          command: "bun install",
          waitBeforeAgentStart: false,
          result: {
            type: "exited",
            exitCode: 0,
            signal: "SIGTERM",
            outputTail: ["Setup stopped."],
          },
        },
      },
      { id: "copies", label: "Copy configured files", state: "completed", details: [] },
    ],
  });
  await h.connection.startupAttempts.complete(h.id);
  const view = h.render();
  try {
    expect(h.connection.startupAttempts.isReadyForHandoff(h.id)).toBe(true);
    expect(h.connection.startupAttempts.getAttempt(h.id)).not.toBeNull();
    expect(view.queryByRole("list", { name: "Session startup steps" }) === null).toBe(true);
    const details = view.getByRole("button", { expanded: false });
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("list", { name: "Session startup steps" })).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: /Run setup.*Failed/ }));
    expect(view.getByText("Command ended with signal SIGTERM.")).toBeDefined();
    expect(view.getByText("Setup stopped.")).toBeDefined();
    expect(h.connection.startupAttempts.getAttempt(h.id)).not.toBeNull();
  } finally {
    view.unmount();
    await h.dispose();
  }
});
