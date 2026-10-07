import { expect, mock, spyOn, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type WorkflowLaunchRequest,
  type WorkflowLaunchSnapshot,
} from "@openducktor/contracts";
import { createHostClient } from "@openducktor/host-client";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RunEventListener } from "@/lib/shell-bridge";
import { createNotificationPolicy } from "../notifications/notification-policy";
import { buildSessionStartErrorOccurrence } from "../notifications/session-start-occurrences";
import { observeWorkflowLaunches } from "../session-start/workflow-launch-observation";
import { presentWorkflowLaunchOutcome } from "../session-start/session-start-message-recovery";
import type { SessionStartNotificationInput } from "../session-start/session-start-orchestration";
import { executeAutopilotAction } from "./autopilot-actions";

const args = {
  activeWorkspace: { workspaceId: "workspace", repoPath: "/repo", workspaceName: "Repo" },
  task: { id: "task", title: "Requested task" },
  actionId: "startBuilder" as const,
};
const unexpectedRecovery = async (): Promise<WorkflowLaunchSnapshot> => {
  throw new Error("Recovery must remain explicit");
};
const result = (request: WorkflowLaunchRequest): WorkflowLaunchSnapshot => ({
  launchAttemptId: request.launchAttemptId,
  workspaceId: request.workspaceId,
  repoPath: request.repoPath,
  taskId: request.taskId,
  role: "build",
  phase: "completed",
  acceptance: "accepted",
  ownershipSaved: true,
  completedPreStartActions: [],
  session: {
    externalSessionId: "saved",
    runtimeKind: "codex",
    workingDirectory: "/worktree/task",
    startedAt: "2026-10-03T12:00:00.000Z",
    status: "running",
  },
});

test("automatic execution needs only observed identity and action, with no browser reads", async () => {
  const launch = mock(async (request: WorkflowLaunchRequest) => result(request));
  const outcome = await executeAutopilotAction({
    ...args,
    client: {
      agentSessionWorkflowLaunch: launch,
      agentSessionWorkflowLaunchRead: async () => [],
      agentSessionWorkflowLaunchRecover: unexpectedRecovery,
    },
  });
  expect(outcome.kind).toBe("started");
  expect(launch.mock.calls[0]?.[0]).toEqual({
    launchAttemptId: expect.any(String),
    workspaceId: "workspace",
    repoPath: "/repo",
    taskId: "task",
    policy: { kind: "automatic", actionId: "startBuilder" },
    instruction: { kind: "kickoff" },
  });
});

test("shows the host's automatic skip reason", async () => {
  const outcome = await executeAutopilotAction({
    ...args,
    client: {
      agentSessionWorkflowLaunchRecover: unexpectedRecovery,
      agentSessionWorkflowLaunchRead: async () => [],
      agentSessionWorkflowLaunch: async (request) => ({
        ...result(request),
        phase: "skipped",
        skipReason: "No Builder source",
      }),
    },
  });
  expect(outcome).toEqual({ kind: "skipped", message: "No Builder source" });
});

test("notification failure does not change an accepted launch or submit it twice", async () => {
  const launch = mock(async (request: WorkflowLaunchRequest) => result(request));
  const reportFailure = mock(() => {});
  const outcome = await executeAutopilotAction({
    ...args,
    client: {
      agentSessionWorkflowLaunch: launch,
      agentSessionWorkflowLaunchRead: async () => [],
      agentSessionWorkflowLaunchRecover: unexpectedRecovery,
    },
    notifications: {
      publishSessionStarted: () => {
        throw new Error("Notification failed");
      },
      publishSessionError: async () => false,
      reportFailure,
    },
  });
  expect(outcome.postStartActionError).toBeNull();
  expect(launch).toHaveBeenCalledTimes(1);
  expect(reportFailure).toHaveBeenCalledTimes(1);
});

test("a disconnected automatic caller reads its accepted attempt without launching again", async () => {
  let retained: WorkflowLaunchSnapshot | undefined;
  const launch = mock(async (request: WorkflowLaunchRequest): Promise<WorkflowLaunchSnapshot> => {
    retained = result(request);
    throw new Error("Transport disconnected");
  });
  const read = mock(async (ref: import("@openducktor/contracts").WorkflowLaunchRef) => {
    if (!retained) throw new Error("Expected the admitted attempt");
    expect(ref.launchAttemptId).toBe(retained.launchAttemptId);
    return [retained];
  });
  const outcome = await executeAutopilotAction({
    ...args,
    client: {
      agentSessionWorkflowLaunch: launch,
      agentSessionWorkflowLaunchRead: read,
      agentSessionWorkflowLaunchRecover: unexpectedRecovery,
    },
  });
  expect(outcome.postStartActionError).toBeNull();
  expect(launch).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
});

test("unknown automatic admission includes inspection guidance in failure delivery", async () => {
  const publishSessionError = mock(
    async (_input: SessionStartNotificationInput, _message: string) => false,
  );
  const showError = spyOn(toast, "error").mockImplementation(() => "toast");
  const failure = { stage: "send" as const, message: "Exact transport failure", cleanupErrors: [] };
  try {
    const outcome = await executeAutopilotAction({
      ...args,
      client: {
        agentSessionWorkflowLaunchRead: async () => [],
        agentSessionWorkflowLaunchRecover: unexpectedRecovery,
        agentSessionWorkflowLaunch: async (request) => ({
          ...result(request),
          phase: "failed",
          acceptance: "unknown",
          recoveryAllowed: false,
          failure,
        }),
      },
      notifications: {
        publishSessionStarted: () => {},
        publishSessionError,
        reportFailure: () => {},
      },
    });
    expect(publishSessionError).toHaveBeenCalledTimes(1);
    expect(publishSessionError.mock.calls[0]?.[1]).toBe(
      "Exact transport failure Runtime acceptance is unknown. Inspect the saved session before sending another instruction.",
    );
    expect(showError.mock.calls.at(-1)?.[1]?.action).toBeUndefined();
    expect(outcome.postStartActionError?.message).toContain("Inspect the saved session");
    expect(failure.message).toBe("Exact transport failure");
  } finally {
    showError.mockRestore();
  }
});

test.each(["before", "after"] as const)(
  "Autopilot suppresses duplicate failure feedback when observation arrives %s its result",
  async (order) => {
    const queryClient = new QueryClient();
    let listener: RunEventListener = () => {};
    let retained: WorkflowLaunchSnapshot | undefined;
    const client = createHostClient(async () => {
      throw new Error("Unexpected host read");
    });
    client.agentSessionWorkflowLaunchRead = async () => [];
    client.agentSessionWorkflowLaunchRecover = async () => {
      throw new Error("Recovery must remain explicit");
    };
    client.agentSessionWorkflowLaunch = async (request) => {
      retained = {
        ...result(request),
        phase: "failed",
        acceptance: "rejected",
        recoveryAllowed: true,
        failure: { stage: "send", message: "Exact first-instruction failure", cleanupErrors: [] },
      };
      if (order === "before")
        listener({ type: "workflow_launch_updated", snapshot: JSON.stringify(retained) });
      return retained;
    };
    const settings = createDefaultNotificationSettings();
    settings.kinds["agent.session_error"] = { enabled: true, target: "both", sound: "inherit" };
    settings.osFocus = "always_send";
    settings.soundFocus = "always_play";
    settings.volumePercent = 50;
    const genericFeedback = mock(async () => {});
    const os = mock(async () => ({ status: "shown" as const }));
    const sound = mock(async () => {});
    const policy = createNotificationPolicy({
      inApp: { deliver: genericFeedback },
      os: { deliver: os },
      sound: { play: sound },
      onFailure: () => {},
    });
    const localFeedback = spyOn(toast, "error").mockImplementation(() => "recovery-toast");
    const stop = await observeWorkflowLaunches({
      workspaceId: args.activeWorkspace.workspaceId,
      repoPath: args.activeWorkspace.repoPath,
      taskIds: [args.task.id],
      queryClient,
      bridge: {
        client,
        subscribeRunEvents: async (next) => {
          listener = next;
          return () => {};
        },
      },
      onSnapshot: (snapshot) => {
        presentWorkflowLaunchOutcome(snapshot, client);
      },
      onError: (cause) => {
        throw cause;
      },
    });
    try {
      const outcome = await executeAutopilotAction({
        ...args,
        client,
        notifications: {
          publishSessionStarted: () => {
            throw new Error("A failed launch must not publish Started");
          },
          publishSessionError: async (input, message) => {
            const occurrence = buildSessionStartErrorOccurrence(
              { repoPath: "/repo", repositoryLabel: "Repo" },
              input,
              message,
            );
            const local = await policy.dispatch(
              occurrence,
              { phase: "local", inAppFeedbackHandled: input.inAppFeedbackHandled === true },
              settings,
            );
            if (local.externalPlan)
              await policy.dispatch(occurrence, { phase: "external", appFocused: true }, settings);
            return local.inAppDelivered;
          },
          reportFailure: (cause) => {
            throw cause;
          },
        },
      });
      if (order === "after")
        listener({ type: "workflow_launch_updated", snapshot: JSON.stringify(retained) });
      expect(outcome.postStartActionError).toHaveProperty("feedbackHandled", true);
      expect(localFeedback).toHaveBeenCalled();
      const ids = new Set(localFeedback.mock.calls.map(([, options]) => options?.id));
      expect(ids.size).toBe(1);
      expect(localFeedback.mock.calls.at(-1)).toEqual([
        "First message failed for task.",
        expect.objectContaining({
          description: "Exact first-instruction failure",
          action: expect.objectContaining({ label: "Retry message" }),
        }),
      ]);
      expect(genericFeedback).not.toHaveBeenCalled();
      expect(os).toHaveBeenCalledTimes(1);
      expect(sound).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      queryClient.clear();
      localFeedback.mockRestore();
    }
  },
);
