import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  AutopilotActionId,
  AutopilotOutcome,
  AutopilotState,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
  type RunEventListener,
  type ShellBridge,
} from "@/lib/shell-bridge";
import { AgentOperationsContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import {
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { taskWorktreeQueryKeys } from "../queries/build-runtime";
import { autopilotSettingsQueryOptions } from "../queries/autopilot";
import { AutopilotProvider } from "./autopilot-provider";
import { createAgentOperationsFixture } from "@/test-utils/agent-operations-fixture";

const alpha = createWorkspaceRecordFixture({ workspaceId: "alpha", repoPath: "/repos/alpha" });
const beta = createWorkspaceRecordFixture({
  workspaceId: "beta",
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

let originalBridge: ShellBridge;
let info: ReturnType<typeof spyOn<typeof toast, "info">>;
let dismiss: ReturnType<typeof spyOn<typeof toast, "dismiss">>;
beforeEach(() => {
  originalBridge = getShellBridge();
  info = spyOn(toast, "info").mockReturnValue("info");
  dismiss = spyOn(toast, "dismiss").mockReturnValue("dismiss");
});
afterEach(() => {
  configureShellBridge(originalBridge);
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
  const bridge = createUnavailableShellBridge();
  bridge.subscribeRunEvents = async (listener) => {
    calls.push("subscribe");
    listeners.push(listener);
    return () => {
      listeners.splice(listeners.indexOf(listener), 1);
    };
  };
  bridge.client.autopilotStateRead = mock(async ({ workspaceId }) => {
    calls.push(`read:${workspaceId}`);
    return held[workspaceId] ?? { outcomes: [], failure: null };
  });
  bridge.client.workspaceGetSettingsSnapshot = mock(readSettings);
  configureShellBridge(bridge);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (activeWorkspace: WorkspaceRecord, workspaces: WorkspaceRecord[]) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceStateContext value={createWorkspaceStateFixture({ activeWorkspace, workspaces })}>
        <AgentOperationsContext value={agentOperations}>
          <NotificationContext value={notifications}>
            <AutopilotProvider />
          </NotificationContext>
        </AgentOperationsContext>
      </WorkspaceStateContext>
    </QueryClientProvider>
  );
  const rendered = render(view(alpha, [alpha, beta]));
  const emit: RunEventListener = (payload) => {
    for (const listener of listeners) listener(payload);
  };
  return {
    calls,
    emit,
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
  test("subscribes before it reads held outcomes, and reads again when a workspace is selected", async () => {
    const provider = renderProvider({
      alpha: { outcomes: [skipped("alpha-held", alpha)], failure: null },
      beta: { outcomes: [skipped("beta-held", beta)], failure: null },
    });
    try {
      await waitFor(() => expect(shownToastIds()).toEqual(["autopilot:alpha-held"]));
      await provider.rerender(beta, [alpha, beta]);
      await waitFor(() =>
        expect(shownToastIds()).toEqual(["autopilot:alpha-held", "autopilot:beta-held"]),
      );
      await provider.rerender(alpha, [alpha, beta]);
      await waitFor(() => expect(provider.calls).toHaveLength(4));

      expect(provider.calls).toEqual(["subscribe", "read:alpha", "read:beta", "read:alpha"]);
      expect(info).toHaveBeenCalledTimes(2);
    } finally {
      provider.unmount();
    }
  });

  test("shows live outcomes from any workspace once and reads again after missed events", async () => {
    const provider = renderProvider({});
    try {
      await waitFor(() => expect(provider.calls).toEqual(["subscribe", "read:alpha"]));
      const event = { type: "autopilot_outcome" as const, outcome: skipped("beta-live", beta) };
      provider.emit(event);
      provider.emit(event);
      provider.emit({ __openducktorBrowserLive: true, kind: "reconnected", missedEvents: false });
      provider.emit({ __openducktorBrowserLive: true, kind: "reconnected", missedEvents: true });
      await waitFor(() => expect(provider.calls).toHaveLength(3));

      expect(shownToastIds()).toEqual(["autopilot:beta-live"]);
      expect(provider.calls).toEqual(["subscribe", "read:alpha", "read:alpha"]);
    } finally {
      provider.unmount();
    }
  });

  test("a started outcome refreshes the task worktree view without a toast", async () => {
    const provider = renderProvider({});
    try {
      await waitFor(() => expect(provider.calls).toEqual(["subscribe", "read:alpha"]));
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
        __openducktorBrowserLive: true as const,
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

  test("dismisses the outcomes of a workspace that leaves the workspace list", async () => {
    const provider = renderProvider({});
    try {
      await waitFor(() => expect(provider.calls).toEqual(["subscribe", "read:alpha"]));
      provider.emit({ type: "autopilot_outcome", outcome: skipped("beta-live", beta) });
      await provider.rerender(alpha, [alpha]);

      expect(dismiss).toHaveBeenCalledWith("autopilot:beta-live");
    } finally {
      provider.unmount();
    }
  });
});
