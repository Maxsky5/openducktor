import { describe, expect, mock, spyOn, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  createDefaultNotificationSettings,
  type NotificationOccurrence,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import {
  createNotificationPolicy,
  type NotificationDispatchContext,
} from "@/features/notifications/notification-policy";
import { startKanbanSessionFlow } from "@/pages/kanban/kanban-session-start-actions";
import { createMessageCardElement } from "@/components/features/agents/agent-chat/agent-chat-message-card-test-harness";
import { buildSessionStartErrorOccurrence } from "@/features/notifications/session-start-occurrences";
import {
  findNotificationAttentionTarget,
  navigateToNotificationTarget,
} from "@/features/notifications/notification-navigation-logic";
import {
  findSessionMessageForTest,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "@/state/operations/agent-orchestrator/handlers/session-actions.test-helpers";
import {
  createSessionStartWorkflowRunner,
  isSessionStartFailureFeedbackHandled,
  type SessionStartNotificationPublisher,
  SessionStartWorkflowError,
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
      const deliverOs = mock(async () => {});
      const policy = createNotificationPolicy({
        loadSettings: async () => settings,
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
        const local = await policy.dispatch(occurrence, { phase: "local" }, settings);
        if (local.externalPlan)
          await policy.dispatch(occurrence, { phase: "external", appFocused: true }, settings);
        return local.inAppDelivered;
      };
      const runSessionStartWorkflow = createSessionStartWorkflowRunner({
        queryClient: new QueryClient(),
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
          openAgentStudioTabOnBackgroundSessionStart: false,
          roleLabels: { spec: "Spec", planner: "Planner", build: "Builder", qa: "QA" },
          runSessionStartWorkflow,
          saveAgentStudioTab: async () => {},
          humanRequestChangesTask: async () => {},
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
        expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
      } finally {
        showError.mockRestore();
      }
    },
  );

  test("publishes Started only for a successful fresh or fork start", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => session),
      notifications,
      createLaunchAttemptId: () => "launch-1",
    });

    await runner(baseInput);

    expect(notifications.publishSessionStarted).toHaveBeenCalledWith({
      launchAttemptId: "launch-1",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskTitle: "Build notifications",
      role: "build",
      session,
    });
    expect(notifications.publishSessionError).not.toHaveBeenCalled();
  });

  test("does not publish Started for reuse", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
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
      queryClient: new QueryClient(),
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
    expect(rejected).toHaveProperty("originalCause", startFailure);
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
      queryClient: new QueryClient(),
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
      queryClient: new QueryClient(),
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
      queryClient: new QueryClient(),
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

  test("publishes only Session Error when the post-start message fails", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
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

    expect(notifications.publishSessionError).toHaveBeenCalledWith(
      expect.objectContaining({ launchAttemptId: "launch-post-error", session }),
      "message failed",
    );
    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
  });

  test("shows preparation failure details and opens the session without a missing error target", async () => {
    const detail = "Runtime readiness failed. Start the runtime and try again.";
    const sessionsRef = createSessionsRef([
      buildSession({ status: "starting", workingDirectory: session.workingDirectory }),
    ]);
    const actions = createSessionActions({
      sessionsRef,
      ensureExistingSessionRuntime: async () => {
        throw new Error(detail);
      },
    });
    const settings = createDefaultNotificationSettings();
    settings.volumePercent = 0;
    settings.kinds["agent.session_error"].target = "in_app";
    const deliver = mock(async () => {});
    const policy = createNotificationPolicy({
      loadSettings: async () => settings,
      inApp: { deliver },
      os: { deliver: async () => {} },
      sound: { play: async () => {} },
      onFailure: () => {},
    });
    const occurrences: NotificationOccurrence[] = [];
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: async () => session,
      sendAgentMessage: actions.sendAgentMessage,
      notifications: {
        ...createPublisher(),
        publishSessionError: async (input, localErrorMessage) => {
          const occurrence = buildSessionStartErrorOccurrence(
            { repoPath: "/repo", repositoryLabel: "Repo" },
            input,
          );
          occurrences.push(occurrence);
          const context: NotificationDispatchContext = { phase: "local" };
          if (localErrorMessage !== undefined) context.errorMessage = localErrorMessage;
          const result = await policy.dispatch(occurrence, context, settings);
          return result.inAppDelivered;
        },
      },
    });
    const result = await runner({
      ...baseInput,
      request: { ...baseInput.request, postStartAction: "send_message", message: "Continue" },
    });
    expect(result).toMatchObject(session);
    expect(result.postStartActionError?.message).toBe(detail);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining(detail) }),
      expect.anything(),
    );
    expect(occurrences[0]?.navigationTarget).toEqual({
      type: "agent_session",
      repoPath: "/repo",
      taskId: "task-1",
      session,
    });
    expect(
      sessionMessagesToArray(getSession(sessionsRef)).some(
        (message) =>
          message.meta?.kind === "session_notice" && message.meta.reason === "session_error",
      ),
    ).toBe(false);
    expect(isSessionStartFailureFeedbackHandled(result.postStartActionError)).toBe(true);
  });

  test("does not claim an error target when the session disappears during send", async () => {
    const sessionsRef = createSessionsRef([
      buildSession({ status: "starting", workingDirectory: session.workingDirectory }),
    ]);
    const adapter = new OpencodeSdkAdapter();
    adapter.sendUserMessage = async () => {
      sessionsRef.current = createSessionsRef().current;
      throw new Error("Session disconnected during send");
    };
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: async () => session,
      sendAgentMessage: actions.sendAgentMessage,
      notifications,
    });
    await runner({
      ...baseInput,
      request: { ...baseInput.request, postStartAction: "send_message", message: "Continue" },
    });
    expect(notifications.publishSessionError).toHaveBeenCalledWith(
      expect.not.objectContaining({ errorAttentionId: expect.anything() }),
      "Session disconnected during send",
    );
  });

  test("focuses the exact rendered error after a post-start message failure", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    adapter.sendUserMessage = async () => {
      throw new Error("message failed");
    };
    const sessionsRef = createSessionsRef([
      buildSession({ status: "starting", workingDirectory: session.workingDirectory }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });
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
      reportFailure: mock(() => {}),
    };
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => session),
      sendAgentMessage: actions.sendAgentMessage,
      notifications,
      createLaunchAttemptId: () => "launch-post-error",
    });

    try {
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
      expect(target?.type).toBe("session_error");
      if (target?.type !== "session_error") {
        throw new Error("Expected a Session Error navigation target.");
      }

      let href = "";
      await navigateToNotificationTarget(target, {
        activeWorkspaceId: "workspace-1",
        workspaces: [{ workspaceId: "workspace-1", repoPath: "/tmp/repo" }],
        selectWorkspace: async () => {},
        loadTasks: async () => [baseInput.task],
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

      const renderedFailure = findSessionMessageForTest(getSession(sessionsRef), (message) =>
        message.content.includes("Failed to send message:"),
      );
      expect(renderedFailure).toBeDefined();
      if (!renderedFailure) {
        throw new Error("Expected the failed send to append an error card.");
      }
      document.body.innerHTML = renderToStaticMarkup(
        createMessageCardElement({ message: renderedFailure }),
      );
      const attentionId = new URL(href, "http://localhost").searchParams.get("attentionId");
      const focusedCard = findNotificationAttentionTarget("error", attentionId ?? "");
      expect(focusedCard).not.toBeNull();
      const focus = mock(() => {});
      if (focusedCard) focusedCard.focus = focus;
      focusedCard?.focus();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toContain(renderedFailure);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
      document.body.replaceChildren();
    }
  });
});
