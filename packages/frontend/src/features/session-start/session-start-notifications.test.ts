import { createSessionStartWorkflowRunner } from "@/test-utils/workflow-launch-client";
import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOccurrence,
  type WorkflowLaunchSnapshot,
} from "@openducktor/contracts";
import { createHostClient } from "@openducktor/host-client";
import type { RunEventListener } from "@/lib/shell-bridge";
import { observeWorkflowLaunches } from "./workflow-launch-observation";
import { presentWorkflowLaunchOutcome } from "./session-start-message-recovery";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createNotificationPolicy,
  type NotificationDispatchContext,
} from "@/features/notifications/notification-policy";
import { navigateToNotificationTarget } from "@/features/notifications/notification-navigation-logic";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "@/state/operations/agent-orchestrator/handlers/session-actions.test-helpers";
import { startKanbanSessionFlow } from "@/pages/kanban/kanban-session-start-actions";
import { buildSessionStartErrorOccurrence } from "@/features/notifications/session-start-occurrences";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  isSessionStartFailureFeedbackHandled,
  type SessionStartNotificationPublisher,
  SessionStartWorkflowError,
  createSessionStartWorkflowRunner as createRunner,
} from "./session-start-orchestration";
import { createTestOpencodeSdkAdapter } from "@/state/operations/agent-orchestrator/handlers/opencode-agent-engine.test-support";

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
    ["unknown", "before"],
    ["unknown", "after"],
    ["accepted", "before"],
    ["accepted", "after"],
    ["not_submitted", "before"],
    ["not_submitted", "after"],
    ["rejected", "before"],
    ["rejected", "after"],
  ] as const)(
    "manual %s failure shares feedback when observation arrives %s its result",
    async (acceptance, order) => {
      const queryClient = new QueryClient();
      let listener: RunEventListener = () => {};
      let retained: WorkflowLaunchSnapshot | undefined;
      const client = createHostClient(async () => {
        throw new Error("Unexpected host read");
      });
      client.agentSessionWorkflowLaunchRead = async () => [];
      client.agentSessionWorkflowLaunchRecover = async () => {
        throw new Error("Recovery must stay explicit");
      };
      client.agentSessionWorkflowLaunch = async (request) => {
        retained = {
          launchAttemptId: request.launchAttemptId,
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
          role: "build",
          phase: "failed",
          acceptance,
          ownershipSaved: acceptance !== "not_submitted",
          completedPreStartActions: [],
          recoveryAllowed: acceptance === "rejected",
          failure: { stage: "send", message: "Exact launch failure", cleanupErrors: [] },
        };
        if (retained.ownershipSaved)
          retained.session = { ...session, startedAt: "2026-10-03T12:00:00.000Z", status: "idle" };
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
      const localFeedback = spyOn(toast, "error").mockImplementation(() => "launch-toast");
      const stop = await observeWorkflowLaunches({
        workspaceId: "workspace-1",
        repoPath: "/repo",
        taskIds: ["task-1"],
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
        const runner = createRunner({
          workspaceId: "workspace-1",
          repoPath: "/repo",
          client,
          notifications: {
            publishSessionStarted: () => {
              throw new Error("A failed launch cannot publish Started");
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
                await policy.dispatch(
                  occurrence,
                  { phase: "external", appFocused: true },
                  settings,
                );
              return local.inAppDelivered;
            },
            reportFailure: (cause) => {
              throw cause;
            },
          },
        });
        const error = await runner(baseInput).then(
          (result) => result.postStartActionError,
          (cause) => cause,
        );
        if (order === "after")
          listener({ type: "workflow_launch_updated", snapshot: JSON.stringify(retained) });
        expect(isSessionStartFailureFeedbackHandled(error)).toBe(true);
        expect(localFeedback).toHaveBeenCalled();
        const ids = new Set(localFeedback.mock.calls.map(([, options]) => options?.id));
        expect(ids.size).toBe(1);
        expect([...ids][0]).toBe(
          JSON.stringify([
            "workflow-launch",
            "workspace-1",
            "/repo",
            "task-1",
            retained!.launchAttemptId,
          ]),
        );
        expect(localFeedback.mock.calls.at(-1)?.[1]?.action !== undefined).toBe(
          acceptance === "rejected",
        );
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
          roleLabels: { spec: "Spec", planner: "Planner", build: "Builder", qa: "QA" },
          runSessionStartWorkflow,
          openSessionInAgentStudio: () => {},
        });
        expect(started).toMatchObject(session);
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError).toHaveBeenCalledWith(
          "First message failed for task-1.",
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
    expect(rejected).toHaveProperty("originalCause.message", startFailure.message);
    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(true);
    expect(notifications.publishSessionError).toHaveBeenCalledWith(
      {
        launchAttemptId: "launch-error",
        inAppFeedbackHandled: true,
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

  test("keeps shared failure feedback when the notification policy delivers no toast", async () => {
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

    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(true);
  });

  test("keeps shared failure feedback when the error notification cannot publish", async () => {
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

    expect(isSessionStartFailureFeedbackHandled(rejected)).toBe(true);
    expect(notifications.reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "notification failed" }),
      expect.objectContaining({ launchAttemptId: "launch-notification-error" }),
    );
  });

  test("does not treat unrelated errors as handled session-start failures", () => {
    expect(isSessionStartFailureFeedbackHandled(new Error("other failure"))).toBe(false);
  });

  test.each(["presenter", "callback"] as const)(
    "reports a failed %s and still publishes launch failure notifications",
    async (source) => {
      const failure = new Error("Feedback failed");
      const notifications = createPublisher();
      notifications.publishSessionError = mock(async () => false);
      const runner = createSessionStartWorkflowRunner({
        queryClient: new QueryClient(),
        workspaceId: "workspace-1",
        startAgentSession: async () => session,
        sendAgentMessage: async () => {
          throw new Error("Send rejected");
        },
        notifications,
      });
      const showError = spyOn(toast, "error").mockImplementation(() => {
        if (source === "presenter") throw failure;
        return "launch-toast";
      });
      const callback = mock(() => {
        if (source === "callback") throw failure;
      });
      try {
        const result = await runner({
          ...baseInput,
          request: { ...baseInput.request, postStartAction: "send_message", message: "Continue" },
          onPostStartMessageFailure: callback,
        });
        expect(callback).toHaveBeenCalledTimes(1);
        expect(notifications.reportFailure).toHaveBeenCalledWith(failure, expect.anything());
        expect(notifications.publishSessionError).toHaveBeenCalledTimes(1);
        expect(notifications.publishSessionError).toHaveBeenCalledWith(
          source === "presenter"
            ? expect.not.objectContaining({ inAppFeedbackHandled: true })
            : expect.objectContaining({ inAppFeedbackHandled: true }),
          "Send rejected",
        );
        expect(isSessionStartFailureFeedbackHandled(result.postStartActionError)).toBe(
          source === "callback",
        );
      } finally {
        showError.mockRestore();
      }
    },
  );

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
    const detail = "Prompt overrides could not be read. Check repository settings and try again.";
    const sessionsRef = createSessionsRef([
      buildSession({ status: "starting", workingDirectory: session.workingDirectory }),
    ]);
    const actions = createSessionActions({
      sessionsRef,
      loadRepoPromptOverrides: async () => {
        throw new Error(detail);
      },
    });
    const settings = createDefaultNotificationSettings();
    settings.volumePercent = 0;
    settings.kinds["agent.session_error"].target = "in_app";
    const deliver = mock(async () => {});
    const policy = createNotificationPolicy({
      inApp: { deliver },
      os: { deliver: async () => ({ status: "shown" }) },
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
    const adapter = createTestOpencodeSdkAdapter();
    adapter.sendUserMessage = async () => {
      sessionsRef.current = createSessionsRef().current;
      throw new Error("Session disconnected during send");
    };
    const actions = createSessionActions({
      adapter,
      sessionsRef,
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

  test("opens the saved session after a host launch failure without an inline error target", async () => {
    const adapter = createTestOpencodeSdkAdapter();
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
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });
});
