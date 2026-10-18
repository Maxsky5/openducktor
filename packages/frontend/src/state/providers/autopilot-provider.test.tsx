import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  AutopilotActionId,
  AutopilotOutcome,
  AutopilotState,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import type { RunEventListener } from "@openducktor/frontend-core/connection/host-connection";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { AgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import {
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { taskWorktreeQueryKeys } from "@openducktor/frontend-core/queries/build-runtime";
import { autopilotSettingsQueryOptions } from "@openducktor/frontend-core/queries/autopilot";
import { AutopilotProvider } from "./autopilot-provider";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";

const alpha = createWorkspaceRecordFixture({ workspaceId: "alpha", repoPath: "/repos/alpha" });
const beta = createWorkspaceRecordFixture({
  workspaceId: "beta",
  workspaceName: "Beta",
  repoPath: "/repos/beta",
  isActive: false,
});

const skipped = (outcomeId: string, workspace: WorkspaceRecord): AutopilotOutcome => ({
  outcomeId,
  workspaceId: workspace.workspaceId,
  repoPath: workspace.repoPath,
  task: { id: `${workspace.workspaceId}-task`, title: "Task" },
  eventId: "taskProgressedToAiReview",
  actionId: "startQa",
  occurredAt: "2026-10-10T00:00:00.000Z",
  kind: "skipped",
  reason: "The task moved on.",
});

const notifications: NotificationContextValue = {
  deliveryFailure: null,
  getCapability: async () => ({
    platform: "browser",
    supported: true,
    permission: "prompt",
    canGuaranteeSilent: true,
    canOpenSystemSettings: false,
  }),
  requestPermission: async () => {
    throw new Error("Unexpected notification permission request.");
  },
  openSystemSettings: async () => {},
  previewCue: async () => {},
  testInApp: async () => {},
  testOs: async () => ({ status: "shown" }),
  registerNavigator: () => () => {},
  sessionStartNotifications: {
    publishSessionStarted: () => {},
    publishSessionError: async () => true,
    markInAppFeedbackHandled: () => {},
    reportFailure: () => {},
  },
};

const agentOperations = createAgentOperationsFixture();

let info: ReturnType<typeof spyOn<typeof toast, "info">>;
let dismiss: ReturnType<typeof spyOn<typeof toast, "dismiss">>;
beforeEach(() => {
  info = spyOn(toast, "info").mockReturnValue("info");
  dismiss = spyOn(toast, "dismiss").mockReturnValue("dismiss");
});
afterEach(() => {
  info.mockRestore();
  dismiss.mockRestore();
});

const renderProvider = (
  held: Record<string, AutopilotState>,
  readSettings: () => Promise<SettingsSnapshot> = async () => {
    throw new Error("Unexpected settings read.");
  },
) => {
  const calls: string[] = [];
  const listeners: RunEventListener[] = [];
  const deferred = new Map<string, PromiseWithResolvers<AutopilotState>>();
  const readState = mock(
    async ({ workspaceId }: { workspaceId: string }): Promise<AutopilotState> => {
      calls.push(`read:${workspaceId}`);
      const read = deferred.get(workspaceId);
      deferred.delete(workspaceId);
      return read ? read.promise : (held[workspaceId] ?? { outcomes: [], failure: null });
    },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = createTestClientConnection({
    queryClient,
    host: createTestHostConnection({
      client: { autopilotStateRead: readState, workspaceGetSettingsSnapshot: mock(readSettings) },
      subscribeRunEvents: async (listener) => {
        calls.push("subscribe");
        listeners.push(listener);
        return () => {
          listeners.splice(listeners.indexOf(listener), 1);
        };
      },
    }),
  });
  const view = (activeWorkspace: WorkspaceRecord, workspaces: WorkspaceRecord[]) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceStateContext value={createWorkspaceStateFixture({ activeWorkspace, workspaces })}>
        <AgentOperationsContext value={agentOperations}>
          <NotificationContext value={notifications}>
            <AutopilotProvider />
          </NotificationContext>
        </AgentOperationsContext>
      </WorkspaceStateContext>
    </ClientConnectionProvider>
  );
  const rendered = render(view(alpha, [alpha, beta]));
  const emit: RunEventListener = (payload) => {
    return Promise.all(listeners.map((listener) => listener(payload))).then(() => {});
  };
  return {
    calls,
    emit,
    /** Holds the next read of the workspace until the test settles it. */
    deferRead: (workspaceId: string) => {
      const read = Promise.withResolvers<AutopilotState>();
      deferred.set(workspaceId, read);
      return read;
    },
    waitForAttachReads: () =>
      waitFor(() => expect(calls).toEqual(["subscribe", "read:alpha", "read:beta"])),
    queryClient,
    rerender: (activeWorkspace: WorkspaceRecord, workspaces: WorkspaceRecord[]) =>
      act(async () => {
        rendered.rerender(view(activeWorkspace, workspaces));
      }),
    unmount: () => {
      rendered.unmount();
      queryClient.clear();
    },
  };
};

const shownToastIds = () => info.mock.calls.map((call) => call[1]?.id);

describe("AutopilotProvider", () => {
  test.each([false, true])(
    "awaits held outcome recovery and propagates failure %s",
    async (failure) => {
      const provider = renderProvider({});
      try {
        await provider.waitForAttachReads();
        // Query has no observer for this read. The reconnect owner must await its application.
        const replacement = provider.deferRead("alpha");
        const recovery = provider.emit({
          __openducktorConnectionControl: true,
          kind: "reconnected",
          missedEvents: true,
        });
        let settled = false;
        const outcome = Promise.resolve(recovery).then(
          () => {
            settled = true;
            return null;
          },
          (cause: unknown) => {
            settled = true;
            return cause;
          },
        );
        await Bun.sleep(0);
        expect(settled).toBe(false);
        if (failure) replacement.reject(new Error("Autopilot recovery failed."));
        else replacement.resolve({ outcomes: [skipped("recovered", alpha)], failure: null });
        const cause = await outcome;
        if (failure) expect(cause).toMatchObject({ message: "Autopilot recovery failed." });
        else {
          expect(cause).toBeNull();
          expect(shownToastIds()).toEqual(["autopilot:recovered"]);
        }
      } finally {
        provider.unmount();
      }
    },
  );
  test("subscribes before it reads the held outcomes of every open workspace, and shows each once", async () => {
    const gamma = createWorkspaceRecordFixture({
      workspaceId: "gamma",
      repoPath: "/repos/gamma",
      isActive: false,
    });
    const provider = renderProvider({
      alpha: { outcomes: [skipped("alpha-held", alpha)], failure: null },
      beta: { outcomes: [skipped("beta-held", beta)], failure: null },
      gamma: { outcomes: [skipped("gamma-held", gamma)], failure: null },
    });
    try {
      await waitFor(() =>
        expect(shownToastIds()).toEqual(["autopilot:alpha-held", "autopilot:beta-held"]),
      );
      // A workspace that opens later is read once.
      await provider.rerender(alpha, [alpha, beta, gamma]);
      await waitFor(() => expect(shownToastIds()).toContain("autopilot:gamma-held"));
      // A selection reads its workspace again, and the outcomes do not show again.
      await provider.rerender(beta, [alpha, beta, gamma]);
      await provider.rerender(alpha, [alpha, beta, gamma]);
      await waitFor(() => expect(provider.calls).toHaveLength(6));

      expect(provider.calls).toEqual([
        "subscribe",
        "read:alpha",
        "read:beta",
        "read:gamma",
        "read:beta",
        "read:alpha",
      ]);
      expect(shownToastIds()).toEqual([
        "autopilot:alpha-held",
        "autopilot:beta-held",
        "autopilot:gamma-held",
      ]);
    } finally {
      provider.unmount();
    }
  });

  test("shows the held outcomes of a read that completes after the selection changed", async () => {
    const provider = renderProvider({});
    const betaRead = provider.deferRead("beta");
    try {
      await provider.waitForAttachReads();
      await provider.rerender(beta, [alpha, beta]);
      await provider.rerender(alpha, [alpha, beta]);
      await act(async () => {
        betaRead.resolve({ outcomes: [skipped("beta-held", beta)], failure: null });
      });

      await waitFor(() => expect(shownToastIds()).toEqual(["autopilot:beta-held"]));
    } finally {
      provider.unmount();
    }
  });

  test("shows live outcomes from any workspace once, and reads every open workspace after missed events", async () => {
    const held: Record<string, AutopilotState> = {};
    const provider = renderProvider(held);
    try {
      await provider.waitForAttachReads();
      const event = { type: "autopilot_outcome" as const, outcome: skipped("beta-live", beta) };
      provider.emit(event);
      provider.emit(event);
      provider.emit({
        __openducktorConnectionControl: true,
        kind: "reconnected",
        missedEvents: false,
      });
      held.alpha = { outcomes: [skipped("alpha-missed", alpha)], failure: null };
      held.beta = {
        outcomes: [skipped("beta-live", beta), skipped("beta-missed", beta)],
        failure: null,
      };
      await provider.emit({
        __openducktorConnectionControl: true,
        kind: "reconnected",
        missedEvents: true,
      });

      expect(shownToastIds()).toEqual([
        "autopilot:beta-live",
        "autopilot:alpha-missed",
        "autopilot:beta-missed",
      ]);
      expect(provider.calls).toEqual([
        "subscribe",
        "read:alpha",
        "read:beta",
        "read:alpha",
        "read:beta",
      ]);
    } finally {
      provider.unmount();
    }
  });

  test("a started outcome refreshes the task worktree view without a toast", async () => {
    const provider = renderProvider({});
    try {
      await provider.waitForAttachReads();
      const worktreeKey = taskWorktreeQueryKeys.taskWorktree({
        repoPath: "/repos/beta",
        taskId: "beta-task",
      });
      provider.queryClient.setQueryData(worktreeKey, null);
      provider.emit({
        type: "autopilot_outcome",
        outcome: {
          outcomeId: "beta-started",
          workspaceId: "beta",
          repoPath: "/repos/beta",
          task: { id: "beta-task", title: "Task" },
          eventId: "taskProgressedToAiReview",
          actionId: "startQa",
          occurredAt: "2026-10-10T00:00:00.000Z",
          kind: "started",
          launch: {
            workspaceId: "beta",
            repoPath: "/repos/beta",
            taskId: "beta-task",
            role: "qa",
            status: "completed",
          },
        },
      });

      await waitFor(() =>
        expect(provider.queryClient.getQueryState(worktreeKey)?.isInvalidated).toBe(true),
      );
      expect(info).not.toHaveBeenCalled();
    } finally {
      provider.unmount();
    }
  });

  test("shows a recoverable failure again when its workspace is selected again", async () => {
    const error = spyOn(toast, "error").mockReturnValue("error");
    const recoverable: AutopilotOutcome = {
      outcomeId: "alpha-recoverable",
      workspaceId: "alpha",
      repoPath: "/repos/alpha",
      task: { id: "alpha-task", title: "Task" },
      eventId: "taskRejectedByQa",
      actionId: "startReviewQaFeedbacks",
      occurredAt: "2026-10-10T00:00:00.000Z",
      kind: "failed",
      message: "The runtime rejected the message.",
      launch: {
        workspaceId: "alpha",
        repoPath: "/repos/alpha",
        taskId: "alpha-task",
        role: "build",
        status: "failed",
        session: {
          externalSessionId: "session-1",
          runtimeKind: "codex",
          workingDirectory: "/worktrees/alpha-task",
          startedAt: "2026-10-10T00:00:00.000Z",
          status: "idle",
        },
        unsentInstruction: [{ kind: "text", text: "Kickoff" }],
      },
    };
    const provider = renderProvider({ alpha: { outcomes: [recoverable], failure: null } });
    try {
      await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      // The user dismisses the toast, leaves the workspace, and selects it again.
      await provider.rerender(beta, [alpha, beta]);
      await provider.rerender(alpha, [alpha, beta]);
      await waitFor(() => expect(error).toHaveBeenCalledTimes(2));

      expect(error.mock.calls.map((call) => call[1]?.id)).toEqual([
        "autopilot:alpha-recoverable",
        "autopilot:alpha-recoverable",
      ]);
    } finally {
      provider.unmount();
      error.mockRestore();
    }
  });

  test.each([
    { name: "a saved-rules event", payload: { type: "autopilot_settings_saved" as const } },
    {
      name: "a reconnect after missed events",
      payload: {
        __openducktorConnectionControl: true as const,
        kind: "reconnected" as const,
        missedEvents: true,
      },
    },
  ])("$name reloads the saved Autopilot rules for an open settings modal", async ({ payload }) => {
    let savedQaActions: AutopilotActionId[] = [];
    const provider = renderProvider({}, async () => ({
      ...createSettingsSnapshotFixture(),
      autopilot: {
        alwaysStartQaReviewsFresh: false,
        rules: [{ eventId: "taskProgressedToAiReview", actionIds: savedQaActions }],
      },
    }));
    // An open settings modal watches the saved rules.
    const observer = new QueryObserver(provider.queryClient, autopilotSettingsQueryOptions());
    const stopObserving = observer.subscribe(() => {});
    const qaActions = () => observer.getCurrentResult().data?.rules[0]?.actionIds;
    try {
      await waitFor(() => expect(qaActions()).toEqual([]));
      savedQaActions = ["startQa"];

      provider.emit(payload);

      await waitFor(() => expect(qaActions()).toEqual(["startQa"]));
    } finally {
      stopObserving();
      provider.unmount();
    }
  });

  test("names the workspace whose held outcomes could not load", async () => {
    const error = spyOn(toast, "error").mockReturnValue("error");
    const provider = renderProvider({});
    const betaRead = provider.deferRead("beta");
    try {
      await provider.waitForAttachReads();
      await act(async () => {
        betaRead.reject(new Error("The host is busy."));
      });

      await waitFor(() =>
        expect(error).toHaveBeenCalledWith("Autopilot outcomes of Beta could not load.", {
          id: "autopilot-read:beta",
          description: "The host is busy. Select Beta again to retry.",
        }),
      );
    } finally {
      provider.unmount();
      error.mockRestore();
    }
  });

  test("does not show the held outcomes of a workspace that leaves the workspace list during the read", async () => {
    const provider = renderProvider({});
    const betaRead = provider.deferRead("beta");
    try {
      await provider.waitForAttachReads();
      await provider.rerender(alpha, [alpha]);
      await act(async () => {
        betaRead.resolve({ outcomes: [skipped("beta-removed", beta)], failure: null });
        await betaRead.promise;
      });

      expect(shownToastIds()).toEqual([]);
    } finally {
      provider.unmount();
    }
  });

  test("dismisses the outcomes of a workspace that leaves the workspace list", async () => {
    const provider = renderProvider({});
    try {
      await provider.waitForAttachReads();
      provider.emit({ type: "autopilot_outcome", outcome: skipped("beta-live", beta) });
      await provider.rerender(alpha, [alpha]);

      expect(dismiss).toHaveBeenCalledWith("autopilot:beta-live");
    } finally {
      provider.unmount();
    }
  });
});
