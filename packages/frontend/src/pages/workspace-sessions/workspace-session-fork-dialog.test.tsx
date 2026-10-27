import { expect, mock, test } from "bun:test";
import {
  repoConfigSchema,
  type WorkspaceSession,
  type WorkspaceSessionForkInput,
  type WorkspaceSessionForkResult,
  type StartupOperationContext,
  type WorkspaceSessionStartInput,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { act, useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createTestClientConnection,
  createTestHostConnection,
  type TestHostConnectionOverrides,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostConnection } from "@openducktor/frontend-core/connection/host-connection";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  sessionForkRequestKey,
  useSessionForkRequests,
} from "@openducktor/frontend-core/sessions/session-forks";
import { WorkspaceSessionForkDialog } from "./workspace-session-fork-dialog";
import { HostInvokeError } from "@openducktor/host-client";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import { StartupNotifications } from "@/features/session-startup/session-startup-stack";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";

const source: WorkspaceSession = {
  id: "source",
  runtimeKind: "codex",
  externalSessionId: "native-source",
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: "/worktrees/source-feature",
    branchName: "odt/source-feature",
    worktreeState: "present",
  },
  roleSnapshot: null,
  selectedModel: null,
  manualTitle: "Source",
  targetBranch: null,
  generatedTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};
const identity = {
  externalSessionId: "native-source",
  runtimeKind: "codex" as const,
  workingDirectory: "/worktrees/source-feature",
};
const point = { messageId: "native-reply" };

function renderFork(
  perform: (
    input: WorkspaceSessionForkInput,
    startup: StartupOperationContext | undefined,
  ) => Promise<WorkspaceSessionForkResult>,
  record = source,
  overrides: TestHostConnectionOverrides = {},
) {
  const store = createAgentSessionsStore("/repo");
  const host = createTestHostConnection({
    ...overrides,
    client: {
      workspaceGetRepoConfig: async () =>
        repoConfigSchema.parse({
          workspaceId: "workspace",
          workspaceName: "Workspace",
          repoPath: "/repo",
          branchPrefix: "odt",
        }),
      workspaceSessionFork: async ({ startup, ...input }) => {
        try {
          return await perform(input, startup);
        } catch (cause) {
          if (!startup) throw cause;
          if (cause instanceof HostInvokeError && cause.failure?.startupProgress) throw cause;
          throw new HostInvokeError(cause instanceof Error ? cause.message : String(cause), {
            kind: "session_startup",
            startupProgress: {
              context: startup,
              hostInstanceId: "host",
              revision: 1,
              workspaceId: input.workspaceId,
              repoPath: "/repo",
              scope: { kind: "workspace" },
              phase: "failed",
              ownership: { state: "not_saved" },
              steps: [],
            },
          });
        }
      },
      ...overrides.client,
    },
  });
  const connection = createTestClientConnection({ host, scheduleTask: () => () => {} });
  const live = createStartupLiveSourceFake(connection.queryClient);
  const completed: WorkspaceSession[] = [];
  let closed = 0;
  const workspace = createWorkspaceRecordFixture({
    workspaceId: "workspace",
    workspaceName: "Workspace",
    repoPath: "/repo",
  });
  function Dialog() {
    const queryClient = useQueryClient();
    const pending = useSessionForkRequests(queryClient);
    const [open, setOpen] = useState(true);
    const location = useLocation();
    return (
      <>
        <output aria-label="Current location">
          {location.pathname}
          {location.search}
        </output>
        <StartupNotifications />
        {open ? (
          <WorkspaceSessionForkDialog
            open={open}
            workspace={workspace}
            record={record}
            source={identity}
            point={point}
            disabledReason={null}
            pending={pending.has(sessionForkRequestKey("/repo", identity, point))}
            onClose={() => {
              closed += 1;
              setOpen(false);
            }}
            onForked={(child) => {
              completed.push(child);
            }}
          />
        ) : null}
      </>
    );
  }
  const view = render(
    <MemoryRouter>
      <QueryProvider connection={connection}>
        <WorkspaceStateContext
          value={createWorkspaceStateFixture({
            workspaces: [workspace],
            activeWorkspace: workspace,
          })}
        >
          <WorkspacePreviewTransitionGuardProvider>
            <AgentSessionsContext value={store}>
              <Dialog />
            </AgentSessionsContext>
          </WorkspacePreviewTransitionGuardProvider>
        </WorkspaceStateContext>
      </QueryProvider>
    </MemoryRouter>,
  );
  return {
    view: {
      ...view,
      unmount: () => {
        view.unmount();
      },
    },
    completed,
    connection,
    live,
    closed: () => closed,
  };
}

test("opening a saved failed fork closes its real dialog and retains the same feedback", async () => {
  const child = { ...source, id: "saved-child", externalSessionId: "native-child" };
  const fork = mock(
    async (_input: WorkspaceSessionForkInput, startup: StartupOperationContext | undefined) => {
      if (!startup) throw new Error("Missing startup context.");
      throw new HostInvokeError("Fork setup failed. Inspect the saved child.", {
        kind: "session_startup",
        startupProgress: {
          context: startup,
          hostInstanceId: "host",
          revision: 1,
          workspaceId: "workspace",
          repoPath: "/repo",
          scope: { kind: "workspace" },
          phase: "failed",
          ownership: { state: "saved", target: { kind: "workspace", record: child } },
          steps: [{ id: "fork", label: "Save forked session", state: "completed", details: [] }],
        },
      });
    },
  );
  const { view, connection, closed, completed } = renderFork(fork);
  try {
    fireEvent.click(view.getByRole("button", { name: "Fork chat" }));
    const open = await view.findByRole("button", { name: "Open session" }, { timeout: 800 });
    const original = connection.startupAttempts.getSnapshot()[0];
    if (!original) throw new Error("Fork attempt is missing.");
    await act(async () => {
      fireEvent.click(open);
    });
    expect(closed()).toBe(1);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByLabelText("Current location").textContent).toBe(
      "/sessions?workspace=workspace&kind=workspace&session=saved-child",
    );
    expect(connection.startupAttempts.getAttempt(original.id)).toMatchObject({
      id: original.id,
      presentation: "notification",
      status: { phase: "failed" },
      operations: original.operations,
    });
    expect(
      await view.findByRole("region", { name: "Session startup notifications" }),
    ).toBeDefined();
    fireEvent.click(await view.findByRole("button", { name: "View progress" }));
    await view.findByRole("list", { name: "Session startup steps" });
    expect(view.getByText("Save forked session")).toBeDefined();
    expect(fork).toHaveBeenCalledTimes(1);
    expect(completed).toEqual([]);
  } finally {
    view.unmount();
    await connection.dispose();
  }
});

test.each([
  ["fork", "automatic"],
  ["fork", "manual"],
  ["repair", "automatic"],
  ["repair", "manual"],
] as const)(
  "%s permits %s workspace handoff after confirmed readiness without racing its response",
  async (operation, handoff) => {
    const response = Promise.withResolvers<void>();
    const publishProgress = Promise.withResolvers<void>();
    const child = { ...source, id: "ready-child", externalSessionId: "native-child" };
    const runtimeSession = {
      runtimeKind: child.runtimeKind,
      externalSessionId: "native-child",
      workingDirectory: child.executionTarget.workingDirectory,
      startedAt: "2026-10-26T00:00:00.000Z",
      status: "idle" as const,
    };
    let receiveProgress: Parameters<HostConnection["subscribeStartupProgress"]>[0] = () => {};
    let live: ReturnType<typeof createStartupLiveSourceFake>;
    const prepare = async (startup: StartupOperationContext | undefined) => {
      if (!startup) throw new Error("Missing startup context.");
      await publishProgress.promise;
      const startupProgress = live.prepared({
        context: startup,
        workspaceId: "workspace",
        repoPath: "/repo",
        scope: { kind: "workspace", sessionId: source.id },
        ownership: { state: "saved", target: { kind: "workspace", record: child, runtimeSession } },
      });
      receiveProgress({
        channel: "openducktor://session-startup-progress",
        payload: startupProgress,
      });
      await response.promise;
      return { session: child, runtimeSession, startupProgress };
    };
    const fork = mock(
      async (_input: WorkspaceSessionForkInput, startup: StartupOperationContext | undefined) => {
        if (!startup) throw new Error("Missing startup context.");
        if (operation === "repair")
          throw new HostInvokeError("Prepare the saved fork again.", {
            kind: "session_startup",
            startupProgress: {
              context: startup,
              hostInstanceId: "host",
              revision: 1,
              workspaceId: "workspace",
              repoPath: "/repo",
              scope: { kind: "workspace", sessionId: source.id },
              phase: "failed",
              ownership: { state: "saved", target: { kind: "workspace", record: child } },
              steps: [
                { id: "save", label: "Save forked session", state: "completed", details: [] },
              ],
            },
          });
        const prepared = await prepare(startup);
        return {
          record: prepared.session,
          runtimeSession,
          startupProgress: prepared.startupProgress,
        };
      },
    );
    const repair = mock(async (input: WorkspaceSessionStartInput) => prepare(input.startup));
    const harness = renderFork(fork, source, {
      subscribeStartupProgress: async (listener) => {
        receiveProgress = listener;
        return () => {};
      },
      client: { workspaceSessionStart: repair },
    });
    live = harness.live;
    try {
      fireEvent.click(harness.view.getByRole("button", { name: "Fork chat" }));
      if (operation === "repair")
        fireEvent.click(
          await harness.view.findByRole(
            "button",
            { name: "Retry session preparation" },
            { timeout: 800 },
          ),
        );
      await waitFor(() => expect(operation === "repair" ? repair : fork).toHaveBeenCalledTimes(1), {
        timeout: 800,
      });
      expect(harness.view.queryByRole("button", { name: "Open session" })).toBeNull();
      await act(async () => {
        publishProgress.resolve();
      });
      await waitFor(
        () =>
          expect(harness.connection.startupAttempts.getSnapshot()[0]?.status.phase).toBe("ready"),
        { timeout: 800 },
      );
      const id = harness.connection.startupAttempts.getSnapshot()[0]?.id;
      if (!id) throw new Error("Fork attempt is missing.");
      expect(harness.completed).toEqual([]);
      expect(harness.closed()).toBe(0);
      expect(harness.view.getByRole("dialog")).toBeDefined();
      const open = harness.view.getByRole("button", { name: "Open session" });
      if (handoff === "manual") {
        await act(async () => {
          fireEvent.click(open);
        });
        expect(harness.view.getByLabelText("Current location").textContent).toBe(
          "/sessions?workspace=workspace&kind=workspace&session=ready-child",
        );
        expect(harness.connection.startupAttempts.getAttempt(id)).toBeNull();
        expect(harness.closed()).toBe(1);
      }
      await act(async () => {
        response.resolve();
      });
      if (handoff === "automatic")
        await waitFor(() => expect(harness.completed).toEqual([child]), { timeout: 800 });
      else expect(harness.completed).toEqual([]);
      expect(harness.connection.startupAttempts.getAttempt(id)).toBeNull();
      expect(harness.view.queryByRole("dialog")).toBeNull();
      expect(harness.view.queryByRole("alert")).toBeNull();
      expect(fork).toHaveBeenCalledTimes(1);
      expect(repair).toHaveBeenCalledTimes(operation === "repair" ? 1 : 0);
    } finally {
      await act(async () => {
        publishProgress.resolve();
        response.resolve();
      });
      harness.view.unmount();
      await harness.connection.dispose();
    }
  },
);

test("fork dialog defaults to the source folder and blocks duplicate submit and close while pending", async () => {
  const calls: WorkspaceSessionForkInput[] = [];
  let reject!: (cause: Error) => void;
  const { view, completed, closed } = renderFork((input) => {
    calls.push(input);
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  try {
    expect(view.getByRole("radio", { name: "Same folder" }).getAttribute("data-state")).toBe(
      "checked",
    );
    expect(view.getByText("/worktrees/source-feature")).toBeDefined();
    expect(view.getByText("source-feature")).toBeDefined();
    expect(view.getByText("odt/source-feature")).toBeDefined();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Fork chat" }));
    });
    expect(calls).toEqual([
      {
        workspaceId: "workspace",
        sessionId: "source",
        forkPoint: point,
        destination: { kind: "same_folder" },
      },
    ]);
    expect(view.getByRole("list", { name: "Session startup steps" })).toBeDefined();
    expect(view.queryByRole("button", { name: "Fork chat" })).toBeNull();
    expect(view.queryByLabelText("Worktree name")).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(view.queryByRole("button", { name: "Close" })).toBeNull();
    expect(calls).toHaveLength(1);
    expect(closed()).toBe(0);
    await act(async () => {
      reject(new Error("The source reply no longer exists. Reload history."));
    });
    expect((await view.findByRole("alert")).textContent).toContain("Reload history");
    fireEvent.click(view.getByRole("button", { name: "Edit choices" }));
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(false);
    expect(completed).toEqual([]);
  } finally {
    view.unmount();
  }
});

test("new worktree uses New chat defaults and validation and keeps inputs after a failed fork", async () => {
  const calls: WorkspaceSessionForkInput[] = [];
  let reject!: (cause: Error) => void;
  const { view, completed } = renderFork((input) => {
    calls.push(input);
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  try {
    fireEvent.click(view.getByRole("radio", { name: "New worktree" }));
    const name = view.getByLabelText("Worktree name");
    expect(view.getByDisplayValue("source-feature-fork")).toBeDefined();
    const branch = view.getByLabelText("Branch name optional");
    await waitFor(() => expect(branch.getAttribute("placeholder")).toBe("odt/source-feature-fork"));
    expect(
      view.getByText("Uncommitted changes in the source folder do not go to the new worktree."),
    ).toBeDefined();
    fireEvent.change(name, { target: { value: "../escape" } });
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("alert").textContent).toContain(
      "Use letters, numbers, hyphens, or underscores",
    );
    fireEvent.change(name, { target: { value: "retry-fork" } });
    fireEvent.change(branch, { target: { value: "feature/alternate" } });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Fork chat" }));
    });
    expect(calls[0]?.destination).toEqual({
      kind: "new_worktree",
      name: "retry-fork",
      branchName: "feature/alternate",
    });
    expect(view.queryByLabelText("Worktree name")).toBeNull();
    expect(view.queryByLabelText("Branch name optional")).toBeNull();
    await act(async () => {
      reject(new Error("Claude refused the fork point. Load another reply."));
    });
    expect((await view.findByRole("alert")).textContent).toContain("Load another reply");
    fireEvent.click(view.getByRole("button", { name: "Edit choices" }));
    expect(view.getByDisplayValue("retry-fork")).toBeDefined();
    expect(view.getByDisplayValue("feature/alternate")).toBeDefined();
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(false);
    expect(completed).toEqual([]);
  } finally {
    view.unmount();
  }
});

test("a repository-root source starts with an empty worktree name", () => {
  const { view } = renderFork(
    async () => {
      throw new Error("Unexpected submit");
    },
    { ...source, executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" } },
  );
  try {
    fireEvent.click(view.getByRole("radio", { name: "New worktree" }));
    expect(view.getByLabelText("Worktree name").getAttribute("value")).toBe("");
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(true);
  } finally {
    view.unmount();
  }
});
