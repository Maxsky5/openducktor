import { createSessionStartWorkflowRunner } from "@/test-utils/workflow-launch-client";
import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOccurrence,
} from "@openducktor/contracts";
import { toast } from "sonner";
import { createNotificationPolicy } from "@/features/notifications/notification-policy";
import { navigateToNotificationTarget } from "@/features/notifications/notification-navigation-logic";
import { startKanbanSessionFlow } from "@/pages/kanban/kanban-session-start-actions";
import { buildSessionStartErrorOccurrence } from "@/features/notifications/session-start-occurrences";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  isSessionStartFailureFeedbackHandled,
  type SessionStartNotificationPublisher,
  SessionStartWorkflowError,
  createSessionStartWorkflowRunner as createRunner,
} from "./session-start-orchestration";

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
  test.each([
    "disabled",
    "os_suppressed",
    "in_app",
    "delivery_failed",
    "publisher_failed",
  ] as const)(
    "preserves background kickoff failure feedback with %s notifications",
    async (scenario) => {
      const settings = createDefaultNotificationSettings();
      settings.volumePercent = 0;
      settings.kinds["agent.session_error"] = {
        enabled: scenario !== "disabled",
        target: scenario === "os_suppressed" ? "os" : "in_app",
        sound: "none",
      };
      const deliverInApp = mock(async () => {
        if (scenario === "delivery_failed") throw new Error("Toast delivery failed");
      });
      const deliverOs = mock(async () => ({ status: "shown" as const }));
      const policy = createNotificationPolicy({
        inApp: { deliver: deliverInApp },
        os: { deliver: deliverOs },
        sound: { play: async () => {} },
        onFailure: () => {},
      });
      const notifications = createPublisher();
      notifications.publishSessionError = async (input) => {
        if (scenario === "publisher_failed") throw new Error("Publication failed");
        const occurrence = buildSessionStartErrorOccurrence(
          { repoPath: "/repo", repositoryLabel: "Repo" },
          input,
        );
        const local = await policy.dispatch(
          occurrence,
          { phase: "local", inAppFeedbackHandled: input.inAppFeedbackHandled === true },
          settings,
        );
        if (local.externalPlan)
          await policy.dispatch(occurrence, { phase: "external", appFocused: true }, settings);
        return local.inAppDelivered;
      };
      const runSessionStartWorkflow = createSessionStartWorkflowRunner({
        workspaceId: "workspace-1",
        startAgentSession: async () => session,
        sendAgentMessage: async () => {
          throw new Error("First message failed");
        },
        notifications,
      });
      const showError = spyOn(toast, "error").mockImplementation(() => "error-toast");
      try {
        const started = await startKanbanSessionFlow({
          request: { ...baseInput.request, postStartAction: "send_message", message: "Continue" },
          decision: baseInput.decision,
          tasks: [baseInput.task],
          workspaceId: "workspace-1",
          startInBackground: true,
          roleLabels: { spec: "Spec", planner: "Planner", build: "Builder", qa: "QA" },
          runSessionStartWorkflow,
          openSessionInAgentStudio: () => {},
        });
        expect(started).toMatchObject(session);
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError).toHaveBeenCalledWith(
          "Session started, but the first message failed.",
          expect.objectContaining({
            description: "First message failed",
            action: expect.objectContaining({ label: "Retry message" }),
          }),
        );
        expect(deliverOs).not.toHaveBeenCalled();
        expect(deliverInApp).not.toHaveBeenCalled();
        expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
      } finally {
        showError.mockRestore();
      }
    },
  );

  test.each(["fresh", "fork"] as const)(
    "publishes Started after a successful %s start",
    async (startMode) => {
      const notifications = createPublisher();
      const runner = createSessionStartWorkflowRunner({
        workspaceId: "workspace-1",
        startAgentSession: mock(async () => session),
        notifications,
        createLaunchAttemptId: () => "launch-1",
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
      createLaunchAttemptId: () => "launch-reuse",
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
      createLaunchAttemptId: () => "launch-error",
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
      createLaunchAttemptId: () => "launch-string-error",
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

  test("leaves feedback to the caller when no in-app notification appears", async () => {
    const notifications = createPublisher();
    notifications.publishSessionError = mock(async () => false);
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => {
        throw new Error("start failed");
      }),
      notifications,
      createLaunchAttemptId: () => "launch-no-in-app",
    });

    let rejected: unknown;
    try {
      await runner(baseInput);
    } catch (cause) {
      rejected = cause;
    }

    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(false);
  });

  test("leaves feedback to the caller when the error notification cannot publish", async () => {
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
      createLaunchAttemptId: () => "launch-notification-error",
    });

    let rejected: unknown;
    try {
      await runner(baseInput);
    } catch (cause) {
      rejected = cause;
    }

    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(false);
    expect(notifications.reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "notification failed" }),
      expect.objectContaining({ launchAttemptId: "launch-notification-error" }),
    );
  });

  test("does not treat unrelated errors as handled session-start failures", () => {
    expect(isSessionStartFailureFeedbackHandled(new Error("other failure"))).toBe(false);
  });

  test("reports a failed retry callback and leaves the launch failure to the host", async () => {
    const failure = new Error("Feedback failed");
    const notifications = createPublisher();
    notifications.publishSessionError = mock(async () => false);
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: async () => session,
      sendAgentMessage: async () => {
        throw new Error("Send rejected");
      },
      notifications,
    });
    const callback = mock(() => {
      throw failure;
    });
    const result = await runner({
      ...baseInput,
      request: { ...baseInput.request, postStartAction: "send_message", message: "Continue" },
      onPostStartMessageFailure: callback,
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(notifications.reportFailure).toHaveBeenCalledWith(failure, expect.anything());
    // The host shows the failure in the saved session and sends its error notification.
    expect(notifications.publishSessionError).not.toHaveBeenCalled();
    expect(isSessionStartFailureFeedbackHandled(result.postStartActionError)).toBe(true);
  });

  test("marks in-app feedback as handled after the retry callback shows it", async () => {
    const notifications = createPublisher();
    notifications.publishSessionError = mock(async () => false);
    const runner = createSessionStartWorkflowRunner({
      workspaceId: "workspace-1",
      startAgentSession: async () => session,
      sendAgentMessage: async () => {
        throw new Error("Send rejected");
      },
      notifications,
    });
    const callback = mock((_result: { retryPostStartMessage?: () => Promise<void> }) => {});
    const result = await runner({
      ...baseInput,
      request: { ...baseInput.request, postStartAction: "send_message", message: "Continue" },
      onPostStartMessageFailure: callback,
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].retryPostStartMessage).toBeFunction();
    expect(notifications.publishSessionError).not.toHaveBeenCalled();
    // The Retry toast shows the error, so the host notification skips its in-app toast.
    expect(notifications.markInAppFeedbackHandled).toHaveBeenCalledWith("launch-failure:fake");
    expect(isSessionStartFailureFeedbackHandled(result.postStartActionError)).toBe(true);
  });

  test("does not call the retry callback when the host accepted the first message", async () => {
    const notifications = createPublisher();
    const callback = mock(() => {});
    const runner = createRunner({
      workspaceId: "workspace-1",
      repoPath: "/repo",
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
      onPostStartMessageFailure: callback,
    });
    expect(callback).not.toHaveBeenCalled();
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
      createLaunchAttemptId: () => "launch-post-error",
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
      publishSessionError: mock(async (input) => {
        occurrences.push(
          buildSessionStartErrorOccurrence(
            { repoPath: "/tmp/repo", repositoryLabel: "OpenDucktor" },
            input,
          ),
        );
        return true;
      }),
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
      createLaunchAttemptId: () => "launch-post-error",
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
