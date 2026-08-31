import { describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
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
  publishSessionError: mock(() => {}),
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
    expect(notifications.publishSessionError).toHaveBeenCalledWith({
      launchAttemptId: "launch-error",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskTitle: "Build notifications",
      role: "build",
    });
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
    );
    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
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
      publishSessionError: mock((input) => {
        occurrences.push(
          buildSessionStartErrorOccurrence(
            { repoPath: "/tmp/repo", repositoryLabel: "OpenDucktor" },
            input,
          ),
        );
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
