import { expect, mock, test } from "bun:test";
import type { WorkflowLaunchRequest, WorkflowLaunchResult } from "@openducktor/contracts";
import type {
  SessionStartNotificationInput,
  SessionStartNotificationPublisher,
} from "../session-start/session-start-orchestration";
import { SessionStartWorkflowError } from "../session-start/session-start-orchestration";
import { executeAutopilotAction } from "./autopilot-actions";

const args = {
  activeWorkspace: { workspaceId: "workspace", repoPath: "/repo", workspaceName: "Repo" },
  task: { id: "task", title: "Requested task" },
  actionId: "startBuilder" as const,
};
const session = {
  externalSessionId: "saved",
  runtimeKind: "codex" as const,
  workingDirectory: "/worktree/task",
  startedAt: "2026-10-03T12:00:00.000Z",
  status: "running" as const,
};
const result = (
  request: WorkflowLaunchRequest,
  overrides: Partial<WorkflowLaunchResult> = {},
): WorkflowLaunchResult => ({
  workspaceId: request.workspaceId,
  repoPath: request.repoPath,
  taskId: request.taskId,
  role: "build",
  status: "completed",
  startMode: "fresh",
  session: { ...session },
  ...overrides,
});
const createNotifications = () => {
  const publishSessionStarted = mock((_input: SessionStartNotificationInput) => {});
  const publishSessionError = mock(
    async (_input: SessionStartNotificationInput, _message?: string) => true,
  );
  const reportFailure = mock(() => {});
  const notifications: SessionStartNotificationPublisher = {
    publishSessionStarted,
    publishSessionError,
    markInAppFeedbackHandled: () => {},
    reportFailure,
  };
  return { notifications, publishSessionStarted, publishSessionError, reportFailure };
};

test("sends one automatic launch with only the workspace, task, and action", async () => {
  const launch = mock(async (request: WorkflowLaunchRequest) => result(request));
  const outcome = await executeAutopilotAction({
    ...args,
    client: { agentSessionWorkflowLaunch: launch },
  });
  expect(outcome).toEqual({
    kind: "started",
    message: "Started Start Builder for task.",
    postStartActionError: null,
  });
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch.mock.calls[0]?.[0]).toEqual({
    workspaceId: "workspace",
    repoPath: "/repo",
    taskId: "task",
    policy: { kind: "automatic", actionId: "startBuilder" },
    instruction: { kind: "kickoff" },
  });
});

test("returns the host skip reason and publishes nothing", async () => {
  const { notifications, publishSessionStarted, publishSessionError } = createNotifications();
  const outcome = await executeAutopilotAction({
    ...args,
    client: {
      agentSessionWorkflowLaunch: async (request) =>
        result(request, { status: "skipped", skipReason: "No Builder source", session: undefined }),
    },
    notifications,
  });
  expect(outcome).toEqual({ kind: "skipped", message: "No Builder source" });
  expect(publishSessionStarted).not.toHaveBeenCalled();
  expect(publishSessionError).not.toHaveBeenCalled();
});

test("returns a failure after the session was saved as a post-start error", async () => {
  const { notifications, publishSessionStarted, publishSessionError } = createNotifications();
  const outcome = await executeAutopilotAction({
    ...args,
    client: {
      agentSessionWorkflowLaunch: async (request) =>
        result(request, {
          status: "failed",
          failure: { message: "Kickoff failed", cleanupErrors: [], noticeId: "launch-failure:1" },
        }),
    },
    notifications,
  });
  expect(outcome.kind).toBe("started");
  if (outcome.kind !== "started") throw new Error("Expected a started outcome");
  expect(outcome.postStartActionError).toBeInstanceOf(SessionStartWorkflowError);
  expect(outcome.postStartActionError?.message).toBe("Kickoff failed");
  // The host reports the failure in the saved session, so Autopilot adds no notification.
  expect(outcome.postStartActionError).toHaveProperty("feedbackHandled", true);
  expect(publishSessionStarted).not.toHaveBeenCalled();
  expect(publishSessionError).not.toHaveBeenCalled();
});

test("notifies a failure that the host could not report in the session", async () => {
  const { notifications, publishSessionError } = createNotifications();
  const outcome = await executeAutopilotAction({
    ...args,
    client: {
      agentSessionWorkflowLaunch: async (request) =>
        result(request, {
          status: "failed",
          failure: { message: "Kickoff failed", cleanupErrors: ["Report failed"] },
        }),
    },
    notifications,
  });
  if (outcome.kind !== "started") throw new Error("Expected a started outcome");
  // Without a session notice, Autopilot must show the failure itself.
  expect(publishSessionError).toHaveBeenCalledTimes(1);
  expect(outcome.postStartActionError).toHaveProperty("feedbackHandled", true);
});

test("throws a start error when the host saved no session", async () => {
  const { notifications, publishSessionError } = createNotifications();
  publishSessionError.mockImplementation(async () => false);
  let thrown: unknown;
  try {
    await executeAutopilotAction({
      ...args,
      client: {
        agentSessionWorkflowLaunch: async (request) =>
          result(request, {
            status: "failed",
            session: undefined,
            failure: { message: "Runtime is offline", cleanupErrors: ["Cannot remove worktree"] },
          }),
      },
      notifications,
    });
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toBeInstanceOf(SessionStartWorkflowError);
  expect(thrown).toHaveProperty("feedbackHandled", false);
  expect(thrown).toHaveProperty(
    "message",
    "Runtime is offline Cleanup failed: Cannot remove worktree",
  );
  expect(publishSessionError).toHaveBeenCalledTimes(1);
  expect(publishSessionError.mock.calls[0]?.[0]).not.toHaveProperty("session");
});

test("publishes session started only when the host started a fresh or forked session", async () => {
  for (const startMode of ["fresh", "fork", "reuse"] as const) {
    const { notifications, publishSessionStarted, publishSessionError } = createNotifications();
    const outcome = await executeAutopilotAction({
      ...args,
      client: { agentSessionWorkflowLaunch: async (request) => result(request, { startMode }) },
      notifications,
    });
    expect(outcome).toMatchObject({ kind: "started", postStartActionError: null });
    expect(publishSessionError).not.toHaveBeenCalled();
    expect(publishSessionStarted).toHaveBeenCalledTimes(startMode === "reuse" ? 0 : 1);
  }
});

test("a notification failure does not change a completed launch", async () => {
  const { notifications, publishSessionStarted, reportFailure } = createNotifications();
  publishSessionStarted.mockImplementation(() => {
    throw new Error("Notification failed");
  });
  const launch = mock(async (request: WorkflowLaunchRequest) => result(request));
  const outcome = await executeAutopilotAction({
    ...args,
    client: { agentSessionWorkflowLaunch: launch },
    notifications,
  });
  expect(outcome.postStartActionError).toBeNull();
  expect(launch).toHaveBeenCalledTimes(1);
  expect(reportFailure).toHaveBeenCalledTimes(1);
});
