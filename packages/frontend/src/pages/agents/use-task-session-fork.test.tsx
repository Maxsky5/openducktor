import { expect, test } from "bun:test";
import type { AgentSessionRecord, AgentWorkflowSessionForkInput } from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostConnection } from "@openducktor/frontend-core/connection/host-connection";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { hasStartupPreparedHandoff } from "@openducktor/frontend-core/sessions/startup/startup-prepared-handoff";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { InlineStartup } from "@/features/session-startup/inline-session-startup";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { useTaskSessionFork } from "./use-task-session-fork";

const SOURCE_HREF = "/sessions?workspace=workspace&kind=task&task=task&session=source&agent=build";
const CHILD_HREF = "/sessions?workspace=workspace&kind=task&task=task&session=child&agent=build";
const childRecord = (): AgentSessionRecord => ({
  externalSessionId: "child",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktrees/task",
  role: "build",
  startedAt: "2026-10-26T00:00:00.000Z",
  selectedModel: null,
});

function createForkHarness({
  failPreparation = false,
  progressBeforeResult,
}: {
  failPreparation?: boolean;
  progressBeforeResult?: "fork" | "repair";
} = {}) {
  const command = Promise.withResolvers<void>();
  const repairCommand = Promise.withResolvers<void>();
  const forkCalls: AgentWorkflowSessionForkInput[] = [];
  const resumeIds: string[] = [];
  const locations: string[] = [];
  const record = childRecord();
  const runtimeSession = { ...record, status: "idle" as const };
  let receiveProgress: Parameters<HostConnection["subscribeStartupProgress"]>[0] = () => {};
  const host = createTestHostConnection({
    subscribeStartupProgress: async (listener) => {
      receiveProgress = listener;
      return () => {};
    },
    client: {
      agentSessionWorkflowFork: async (input) => {
        forkCalls.push(input);
        if (!input.startup) throw new Error("Missing startup context.");
        if (failPreparation) {
          await command.promise;
          throw new HostInvokeError("Native preparation failed.", {
            kind: "session_startup",
            startupProgress: {
              context: input.startup,
              hostInstanceId: "host",
              revision: 1,
              workspaceId: "workspace",
              repoPath: input.repoPath,
              scope: { kind: "task", taskId: "task", role: "build" },
              phase: "failed",
              ownership: { state: "saved", target: { kind: "task", record } },
              steps: [],
            },
          });
        }
        const startupProgress = live.prepared({
          context: input.startup,
          workspaceId: "workspace",
          repoPath: input.repoPath,
          scope: { kind: "task", taskId: "task", role: "build" },
          ownership: { state: "saved", target: { kind: "task", record, runtimeSession } },
        });
        if (progressBeforeResult === "fork")
          receiveProgress({
            channel: "openducktor://session-startup-progress",
            payload: startupProgress,
          });
        await command.promise;
        return {
          record,
          runtimeSession,
          startupProgress,
        };
      },
      agentSessionControlResume: async (input) => {
        resumeIds.push(input.externalSessionId);
        if (!input.startup) throw new Error("Missing repair startup context.");
        const startupProgress = live.prepared({
          context: input.startup,
          workspaceId: "workspace",
          repoPath: input.repoPath,
          scope: { kind: "task", taskId: "task", role: "build" },
          ownership: { state: "saved", target: { kind: "task", record, runtimeSession } },
        });
        if (progressBeforeResult === "repair") {
          receiveProgress({
            channel: "openducktor://session-startup-progress",
            payload: startupProgress,
          });
          await repairCommand.promise;
        }
        return {
          ...runtimeSession,
          startupProgress,
        };
      },
    },
  });
  const connection = createTestClientConnection({ host, scheduleTask: () => () => {} });
  const live = createStartupLiveSourceFake(connection.queryClient);
  const store = createAgentSessionsStore("/repo");
  const workspace = createWorkspaceRecordFixture({ workspaceId: "workspace", repoPath: "/repo" });
  function Source({ source }: { source: string }) {
    const { actions, error } = useTaskSessionFork({
      repoPath: "/repo",
      workspaceId: "workspace",
      identity: {
        externalSessionId: source,
        runtimeKind: "codex",
        workingDirectory: "/repo/worktrees/task",
      },
      scope: { kind: "workflow", taskId: "task", role: "build" },
      disabledReason: null,
    });
    return (
      <>
        <button type="button" onClick={() => actions?.onFork({ messageId: "reply" })}>
          Fork reply
        </button>
        <output aria-label="Fork error">{error}</output>
        <InlineStartup repoPath="/repo" taskId="task" role="build" />
      </>
    );
  }
  function Harness() {
    const [source, setSource] = useState("source");
    const [active, setActive] = useState(true);
    const location = useLocation();
    const navigate = useNavigate();
    const href = `${location.pathname}${location.search}`;
    useEffect(() => {
      locations.push(href);
    }, [href, location.key]);
    return (
      <>
        <output aria-label="Current location">{href}</output>
        <button
          type="button"
          onClick={() => {
            void navigate("/kanban");
          }}
        >
          Leave page
        </button>
        <button
          type="button"
          onClick={() => {
            setSource("another-source");
            void navigate(
              "/sessions?workspace=workspace&kind=task&task=task&session=another-source&agent=build",
            );
          }}
        >
          Switch source session
        </button>
        <button type="button" onClick={() => setActive(false)}>
          Hide view
        </button>
        {location.pathname === "/sessions" ? (
          <SessionViewContext value={{ id: "task-view", isActive: active }}>
            <Source source={source} />
          </SessionViewContext>
        ) : null}
      </>
    );
  }
  const view = render(
    <MemoryRouter initialEntries={[SOURCE_HREF]}>
      <QueryProvider connection={connection}>
        <AgentSessionsContext value={store}>
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
        </AgentSessionsContext>
      </QueryProvider>
    </MemoryRouter>,
  );
  return {
    view,
    connection,
    forkCalls,
    resumeIds,
    locations,
    finish: async () => {
      await act(async () => {
        command.resolve();
      });
    },
    finishRepair: async () => {
      await act(async () => {
        repairCommand.resolve();
      });
    },
    dispose: async () => {
      await act(async () => {
        command.resolve();
        repairCommand.resolve();
      });
      view.unmount();
      await connection.dispose();
    },
  };
}

test("a reply fork shows inline progress and opens the exact child once before retiring the trace", async () => {
  const harness = createForkHarness();
  try {
    fireEvent.click(harness.view.getByRole("button", { name: "Fork reply" }));
    await waitFor(() => expect(harness.forkCalls).toHaveLength(1), { timeout: 800 });
    expect(
      harness.view.getByRole("button", { name: /View progress$/, expanded: false }),
    ).toBeDefined();
    expect(harness.view.getByLabelText("Current location").textContent).toBe(SOURCE_HREF);
    await harness.finish();
    await waitFor(
      () => expect(harness.view.getByLabelText("Current location").textContent).toBe(CHILD_HREF),
      { timeout: 800 },
    );
    expect(harness.locations.filter((href) => href === CHILD_HREF)).toHaveLength(1);
    expect(harness.connection.startupAttempts.getSnapshot()).toEqual([]);
    expect(
      hasStartupPreparedHandoff(harness.connection.queryClient, {
        repoPath: "/repo",
        externalSessionId: "child",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktrees/task",
      }),
    ).toBe(true);
    expect(harness.view.queryByRole("button", { name: /View progress$/ })).toBeNull();
  } finally {
    await harness.dispose();
  }
});

test.each(["Leave page", "Switch source session", "Hide view"])(
  "%s transfers the same reply fork and prevents completion navigation",
  async (action) => {
    const harness = createForkHarness();
    try {
      fireEvent.click(harness.view.getByRole("button", { name: "Fork reply" }));
      await waitFor(() => expect(harness.forkCalls).toHaveLength(1), { timeout: 800 });
      expect(
        harness.view.getByRole("button", { name: /View progress$/, expanded: false }),
      ).toBeDefined();
      const id = harness.connection.startupAttempts.getSnapshot()[0]?.id;
      if (!id) throw new Error("Fork attempt is missing.");
      fireEvent.click(harness.view.getByRole("button", { name: action }));
      const location = harness.view.getByLabelText("Current location").textContent;
      expect(harness.connection.startupAttempts.getAttempt(id)?.presentation).toBe("notification");
      await harness.finish();
      await waitFor(
        () => expect(harness.connection.startupAttempts.getAttempt(id)?.status.phase).toBe("ready"),
        { timeout: 800 },
      );
      expect(harness.view.getByLabelText("Current location").textContent).toBe(location);
      expect(harness.locations).not.toContain(CHILD_HREF);
      expect(harness.forkCalls).toHaveLength(1);
      expect(harness.connection.startupAttempts.getAttempt(id)?.navigationTarget).toMatchObject({
        kind: "task_session",
        workspaceId: "workspace",
        taskId: "task",
        role: "build",
        identity: {
          externalSessionId: "child",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktrees/task",
        },
      });
    } finally {
      await harness.dispose();
    }
  },
);

test("repair opens the retained fork once without another fork request", async () => {
  const harness = createForkHarness({ failPreparation: true });
  try {
    fireEvent.click(harness.view.getByRole("button", { name: "Fork reply" }));
    await waitFor(() => expect(harness.forkCalls).toHaveLength(1), { timeout: 800 });
    await harness.finish();
    fireEvent.click(harness.view.getByRole("button", { name: /View progress$/, expanded: false }));
    fireEvent.click(
      await harness.view.findByRole(
        "button",
        { name: "Retry session preparation" },
        { timeout: 800 },
      ),
    );
    await waitFor(
      () => expect(harness.locations.filter((href) => href === CHILD_HREF)).toHaveLength(1),
      { timeout: 800 },
    );
    expect(harness.view.getByLabelText("Current location").textContent).toBe(CHILD_HREF);
    expect(harness.forkCalls).toHaveLength(1);
    expect(harness.resumeIds).toEqual(["child"]);
    expect(harness.connection.startupAttempts.getSnapshot()).toEqual([]);
  } finally {
    await harness.dispose();
  }
});

test.each(["fork", "repair"] as const)(
  "%s progress waits for its command result before opening and retiring the trace",
  async (operation) => {
    const harness = createForkHarness({
      failPreparation: operation === "repair",
      progressBeforeResult: operation,
    });
    try {
      fireEvent.click(harness.view.getByRole("button", { name: "Fork reply" }));
      await waitFor(() => expect(harness.forkCalls).toHaveLength(1), { timeout: 800 });
      if (operation === "repair") {
        await harness.finish();
        fireEvent.click(
          harness.view.getByRole("button", { name: /View progress$/, expanded: false }),
        );
        fireEvent.click(
          await harness.view.findByRole(
            "button",
            { name: "Retry session preparation" },
            { timeout: 800 },
          ),
        );
      }
      await waitFor(
        () =>
          expect(harness.connection.startupAttempts.getSnapshot()[0]?.status.phase).toBe("ready"),
        { timeout: 800 },
      );
      expect(harness.view.getByLabelText("Current location").textContent).toBe(SOURCE_HREF);
      expect(harness.locations).not.toContain(CHILD_HREF);
      if (operation === "repair") await harness.finishRepair();
      else await harness.finish();
      await waitFor(
        () => expect(harness.view.getByLabelText("Current location").textContent).toBe(CHILD_HREF),
        { timeout: 800 },
      );
      expect(harness.locations.filter((href) => href === CHILD_HREF)).toHaveLength(1);
      expect(harness.connection.startupAttempts.getSnapshot()).toEqual([]);
      expect(harness.view.getByLabelText("Fork error").textContent).toBe("");
      expect(
        hasStartupPreparedHandoff(harness.connection.queryClient, {
          repoPath: "/repo",
          ...childRecord(),
        }),
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  },
);
