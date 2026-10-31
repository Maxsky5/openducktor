import { BUILTIN_ROLE_LABELS } from "@openducktor/workflows";
import { createSessionStartWorkflowRunner } from "@/test-utils/workflow-launch-client";
import { describe, expect, mock, test } from "bun:test";
import { type NotificationOccurrence } from "@openducktor/contracts";
import { navigateToNotificationTarget } from "@/features/notifications/notification-navigation-logic";
import { buildSessionStartErrorOccurrence } from "@openducktor/core";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  isSessionStartFailureFeedbackHandled,
  type SessionStartNotificationPublisher,
  SessionStartWorkflowError,
  createSessionStartWorkflowRunner as createRunner,
} from "@openducktor/frontend-core/sessions/start/session-start-orchestration";

const selection = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build-agent",
};

const session = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
};

const createPublisher = (): SessionStartNotificationPublisher => ({
  publishSessionStarted: mock(() => {}),
  publishSessionError: mock(async () => true),
  markInAppFeedbackHandled: mock(() => {}),
  reportFailure: mock(() => {}),
});

const baseInput = {
  request: {
    taskId: "task-1",
    role: "build" as const,
    launchActionId: "build_implementation_start" as const,
    postStartAction: "none" as const,
  },
  decision: { startMode: "fresh" as const, selectedModel: selection },
  task: createTaskCardFixture({ id: "task-1", title: "Build notifications" }),
};

describe("session-start notifications", () => {
  test.each(["fresh", "fork"] as const)(
    "publishes Started after a successful %s start",
    async (startMode) => {
      const notifications = createPublisher();
      const runner = createSessionStartWorkflowRunner({
        workspaceId: "workspace-1",
        startAgentSession: mock(async () => session),
        notifications,
        launchAttemptId: "launch-1",
      });

      await runner({
        ...baseInput,
        decision:
          startMode === "fork"
            ? { startMode, selectedModel: selection, sourceSession: session }
            : baseInput.decision,
      });

      expect(notifications.publishSessionStarted).toHaveBeenCalledWith({
        launchAttemptId: "launch-1",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskTitle: "Build notifications",
        role: "build",
        inAppFeedbackHandled: true,
        session,
      });
      expect(notifications.publishSessionError).not.toHaveBeenCalled();
    },
  );

  test("does not publish Started for reuse", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => session),
      notifications,
      launchAttemptId: "launch-reuse",
    });

    await runner({
      ...baseInput,
      decision: { startMode: "reuse", sourceSession: session },
    });

    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
    expect(notifications.publishSessionError).not.toHaveBeenCalled();
  });

  test("publishes one task-only Session Error when creation fails", async () => {
    const notifications = createPublisher();
    const startFailure = new Error("start failed");
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => {
        throw startFailure;
      }),
      notifications,
      launchAttemptId: "launch-error",
    });

    let rejected: unknown;
    try {
      await runner(baseInput);
    } catch (cause) {
      rejected = cause;
    }

    expect(rejected).toBeInstanceOf(SessionStartWorkflowError);
    expect(rejected).toHaveProperty("originalCause.message", startFailure.message);
    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(true);
    expect(notifications.publishSessionError).toHaveBeenCalledWith(
      {
        launchAttemptId: "launch-error",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskTitle: "Build notifications",
        role: "build",
        inAppFeedbackHandled: true,
      },
      startFailure.message,
    );
    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
  });

  test("marks non-Error start failures as handled when the notification publishes", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => {
        throw "start failed";
      }),
      notifications,
      launchAttemptId: "launch-string-error",
    });

    let rejected: unknown;
    try {
      await runner(baseInput);
    } catch (cause) {
      rejected = cause;
    }

    expect(rejected).toBeInstanceOf(SessionStartWorkflowError);
    expect(rejected).toHaveProperty("message", "start failed");
    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(true);
  });

  test("reports notification failure while the startup trace handles feedback", async () => {
    const notifications = createPublisher();
    notifications.publishSessionError = mock(() => {
      throw new Error("notification failed");
    });
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => {
        throw new Error("start failed");
      }),
      notifications,
      launchAttemptId: "launch-notification-error",
    });

    let rejected: unknown;
    try {
      await runner(baseInput);
    } catch (cause) {
      rejected = cause;
    }

    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(true);
    expect(notifications.reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "notification failed" }),
      expect.objectContaining({ launchAttemptId: "launch-notification-error" }),
    );
  });

  test("does not treat unrelated errors as handled session-start failures", () => {
    expect(isSessionStartFailureFeedbackHandled(new Error("other failure"))).toBe(false);
  });

  test("preserves accepted-message evidence when the host reports a later failure", async () => {
    const notifications = createPublisher();
    const runner = createRunner({
      workspaceId: "workspace-1",
      repoPath: "/repo",
      launchAttemptId: "launch-accepted",
      sendAgentMessage: async () => {
        throw new Error("Unexpected resend");
      },
      client: {
        agentSessionWorkflowLaunch: async (request) => ({
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
          role: "build",
          status: "failed",
          startMode: "fresh",
          session: { ...session, startedAt: "2026-03-01T00:00:00.000Z", status: "running" },
          acceptedMessage: {
            type: "user_message",
            externalSessionId: session.externalSessionId,
            messageId: "message-1",
            message: "Continue",
            parts: [],
            timestamp: "2026-03-01T00:00:00.000Z",
            state: "read",
          },
          failure: {
            message: "Stream closed after acceptance",
            cleanupErrors: [],
            noticeId: "launch-failure:1",
          },
        }),
      },
      notifications,
    });
    const result = await runner({
      ...baseInput,
      request: { ...baseInput.request, postStartAction: "send_message", message: "Continue" },
    });
    expect(result.retryPostStartMessage).toBeUndefined();
    expect(result.postStartMessageReceipt?.postAcceptanceFailure).toBe(
      "Stream closed after acceptance",
    );
    expect(notifications.publishSessionError).not.toHaveBeenCalled();
    expect(isSessionStartFailureFeedbackHandled(result.postStartActionError)).toBe(true);
    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
  });

  test("publishes neither notification when the host reports a failed first message", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => session),
      sendAgentMessage: mock(async () => {
        throw new Error("message failed");
      }),
      notifications,
      launchAttemptId: "launch-post-error",
    });

    await runner({
      ...baseInput,
      request: {
        ...baseInput.request,
        postStartAction: "send_message",
        message: "Continue",
      },
    });

    expect(notifications.publishSessionError).not.toHaveBeenCalled();
    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
  });

  test("opens the saved session after a canceled launch without an inline error target", async () => {
    const occurrences: NotificationOccurrence[] = [];
    const notifications: SessionStartNotificationPublisher = {
      publishSessionStarted: mock(() => {}),
      publishSessionError: mock(
        async (input: Parameters<SessionStartNotificationPublisher["publishSessionError"]>[0]) => {
          occurrences.push(
            buildSessionStartErrorOccurrence(
              { repoPath: "/tmp/repo", repositoryLabel: "OpenDucktor" },
              { ...input, roleLabel: BUILTIN_ROLE_LABELS[input.role] },
            ),
          );
          return true;
        },
      ),
      markInAppFeedbackHandled: () => {},
      reportFailure: mock(() => {}),
    };
    // The host reports only failed launches, so the frontend still reports a canceled one.
    const runner = createRunner({
      workspaceId: "workspace-1",
      repoPath: "/tmp/repo",
      sendAgentMessage: async () => null,
      client: {
        agentSessionWorkflowLaunch: async (request) => ({
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
          role: "build",
          status: "canceled",
          startMode: "fresh",
          session: { ...session, startedAt: "2026-03-01T00:00:00.000Z", status: "idle" },
          failure: { message: "Session launch was canceled.", cleanupErrors: [] },
        }),
      },
      notifications,
      launchAttemptId: "launch-post-error",
    });

    await runner({
      ...baseInput,
      request: {
        ...baseInput.request,
        postStartAction: "send_message",
        message: "Continue",
      },
    });

    const occurrence = occurrences[0];
    expect(occurrence?.kind).toBe("agent.session_error");
    const target = occurrence?.navigationTarget;
    expect(target?.type).toBe("agent_session");
    if (target?.type !== "agent_session") {
      throw new Error("Expected an Agent Session navigation target.");
    }

    let href = "";
    await navigateToNotificationTarget(target, {
      activeWorkspaceId: "workspace-1",
      workspaces: [{ workspaceId: "workspace-1", repoPath: "/tmp/repo" }],
      selectWorkspace: async () => {},
      loadTasks: async () => [baseInput.task],
      loadWorkspaceSessions: async () => [],
      loadTaskSessions: async () => [
        {
          ...session,
          role: "build",
          startedAt: "2026-08-31T12:00:00.000Z",
          selectedModel: null,
        },
      ],
      navigate: (nextHref) => {
        href = nextHref;
      },
      openSettings: () => {},
      reportStale: (message) => {
        throw new Error(message);
      },
    });

    const location = new URL(href, "http://localhost");
    expect(location.searchParams.get("session")).toBe(session.externalSessionId);
    expect(location.searchParams.has("attentionId")).toBe(false);
  });
});
