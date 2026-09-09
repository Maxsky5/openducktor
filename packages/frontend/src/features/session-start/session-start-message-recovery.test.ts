import { expect, mock, spyOn, test } from "bun:test";
import { createDefaultNotificationSettings } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { toast, type Action } from "sonner";
import { createSonnerNotificationAdapter } from "@/features/notifications/notification-delivery";
import { createNotificationRuntime } from "@/features/notifications/notification-runtime";
import { buildSessionStartErrorOccurrence } from "@/features/notifications/session-start-occurrences";
import type { NotificationBridge } from "@/lib/shell-bridge";
import { startKanbanSessionFlow } from "@/pages/kanban/kanban-session-start-actions";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { createSessionStartWorkflowRunner } from "./session-start-orchestration";

test.each(["in_app", "both", "os", "disabled"] as const)(
  "shows one recovery toast and preserves external delivery with %s notifications",
  async (target) => {
    const settings = createDefaultNotificationSettings();
    settings.osFocus = "always_send";
    settings.soundFocus = "always_play";
    settings.volumePercent = 30;
    settings.kinds["agent.session_error"] = {
      enabled: target !== "disabled",
      target: target === "disabled" ? "in_app" : target,
      sound: "inherit",
    };
    const genericToast = mock(() => "generic-toast");
    const recoveryToast = spyOn(toast, "error").mockImplementation(() => "recovery-toast");
    const showOsNotification = mock(async () => ({ status: "shown" as const }));
    const playSound = mock(async () => {});
    let onOccurrence: Parameters<NotificationBridge["subscribeOccurrences"]>[0] = () => {};
    const bridge: NotificationBridge = {
      getCapability: async () => ({
        platform: "browser",
        supported: true,
        permission: "granted",
        canGuaranteeSilent: true,
        canOpenSystemSettings: false,
      }),
      requestPermission: async () => ({
        platform: "browser",
        supported: true,
        permission: "granted",
        canGuaranteeSilent: true,
        canOpenSystemSettings: false,
      }),
      openSystemSettings: async () => {},
      isAppFocused: async () => true,
      withExternalDeliveryOwnership: async (_id, dispatch) => dispatch(true),
      showOsNotification,
      publishOccurrence: async (occurrence, selectedSettings) => {
        onOccurrence(occurrence, selectedSettings);
        return { occurrence, settings: selectedSettings };
      },
      subscribeOccurrences: (listener) => {
        onOccurrence = listener;
        return () => {};
      },
      subscribeClicks: () => () => {},
      dispose: () => {},
    };
    const runtime = createNotificationRuntime({
      bridge,
      loadSettings: async () => settings,
      navigate: async () => {},
      onFailure: () => {},
      onCoordinationRecovered: () => {},
      inApp: createSonnerNotificationAdapter({ showToast: genericToast, navigate: async () => {} }),
      sound: { play: playSound },
    });
    const stop = runtime.subscribe();
    const session = {
      externalSessionId: "recovery-session",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
    };
    const start = mock(async () => session);
    let failSend = true;
    const send = mock(async () => {
      if (failSend) throw new Error("First message failed");
    });
    const runSessionStartWorkflow = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: start,
      sendAgentMessage: send,
      notifications: {
        publishSessionStarted: () => {},
        publishSessionError: (input, message) =>
          runtime.publishAndWait(
            buildSessionStartErrorOccurrence(
              { repoPath: "/repo", repositoryLabel: "Repo" },
              input,
              message,
            ),
            message,
            input.inAppFeedbackHandled,
          ),
        reportFailure: () => {},
      },
    });
    try {
      await startKanbanSessionFlow({
        request: {
          taskId: "task-1",
          role: "build",
          launchActionId: "build_implementation_start",
          postStartAction: "kickoff",
        },
        decision: {
          startMode: "fresh",
          kickoffPrompt: "retry this exact text",
          selectedModel: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
        },
        tasks: [createTaskCardFixture({ id: "task-1" })],
        workspaceId: "workspace-1",
        startInBackground: false,
        openAgentStudioTabOnBackgroundSessionStart: false,
        roleLabels: { spec: "Spec", planner: "Planner", build: "Builder", qa: "QA" },
        runSessionStartWorkflow,
        saveAgentStudioTab: async () => {},
        humanRequestChangesTask: async () => {},
        openSessionInAgentStudio: () => {},
      });
      expect(genericToast).not.toHaveBeenCalled();
      expect(recoveryToast).toHaveBeenCalledTimes(1);
      expect(showOsNotification).toHaveBeenCalledTimes(
        target === "both" || target === "os" ? 1 : 0,
      );
      expect(playSound).toHaveBeenCalledTimes(target === "disabled" ? 0 : 1);
      const action = recoveryToast.mock.calls[0]?.[1]?.action;
      expect(action).toEqual(
        expect.objectContaining({ label: "Retry message", onClick: expect.any(Function) }),
      );
      // SAFETY: The assertion checks the recovery action. Its callback takes no event argument.
      const retryAction = action as Action & { onClick(): void };
      failSend = false;
      retryAction.onClick();
      expect(start).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    } finally {
      stop();
      recoveryToast.mockRestore();
    }
  },
);
