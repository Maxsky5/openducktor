import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOccurrence,
  type NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import type { NotificationBridge } from "@/lib/shell-bridge";
import { createNotificationRuntime } from "./notification-runtime";

const createBridge = (overrides: Partial<NotificationBridge> = {}): NotificationBridge => ({
  getCapability: async () => ({
    platform: "browser",
    supported: true,
    permission: "prompt",
    canGuaranteeSilent: true,
  }),
  requestPermission: async () => ({
    platform: "browser",
    supported: true,
    permission: "granted",
    canGuaranteeSilent: true,
  }),
  isAppFocused: async () => false,
  withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => dispatch(true),
  showOsNotification: async () => ({ status: "shown" }),
  publishOccurrence: () => {},
  subscribeOccurrences: () => () => {},
  subscribeClicks: () => () => {},
  dispose: () => {},
  ...overrides,
});

describe("notification runtime tests", () => {
  test("bounds display text before publishing the occurrence", () => {
    const publishOccurrence = mock((_occurrence: NotificationOccurrence) => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({ publishOccurrence }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
    });

    runtime.publish({
      occurrenceId: "occurrence-long-copy",
      kind: "agent.session_idle",
      repoPath: "/repo",
      repositoryLabel: "r".repeat(140),
      task: { id: "task-1", title: "t".repeat(260) },
      sessionLabel: "s".repeat(140),
      status: "Agent Session is idle.",
      navigationTarget: {
        type: "agent_session",
        repoPath: "/repo",
        session: {
          runtimeKind: "opencode",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        },
      },
    });

    const published = publishOccurrence.mock.calls[0]?.[0];
    expect(published?.repositoryLabel).toHaveLength(120);
    expect(published?.task?.title).toHaveLength(240);
    expect(published?.sessionLabel).toHaveLength(120);
  });

  test("requests permission only from the explicit OS test", async () => {
    const requestPermission = mock(async () => ({
      platform: "browser" as const,
      supported: true,
      permission: "granted" as const,
      canGuaranteeSilent: true,
    }));
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({ requestPermission, showOsNotification }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
    });
    const settings = createDefaultNotificationSettings();
    settings.volumePercent = 0;

    await runtime.getCapability();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(showOsNotification).not.toHaveBeenCalled();
    await runtime.testOs(settings);

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(showOsNotification.mock.calls[0]?.[0].silent).toBe(true);
  });

  test("does not attempt OS delivery when permission is denied", async () => {
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        requestPermission: async () => ({
          platform: "browser",
          supported: true,
          permission: "denied",
          canGuaranteeSilent: true,
        }),
        showOsNotification,
      }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
    });

    const result = await runtime.testOs(createDefaultNotificationSettings());
    expect(result.status).toBe("denied");
    expect(showOsNotification).not.toHaveBeenCalled();
  });

  test("does not send OS delivery when another browser tab owns external delivery", async () => {
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const withExternalDeliveryOwnership = mock(
      async (_occurrenceId: string, dispatch: (owner: boolean) => Promise<void>) => dispatch(false),
    );
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        withExternalDeliveryOwnership,
        showOsNotification,
      }),
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.volumePercent = 0;
        return settings;
      },
      navigate: async () => {},
      onFailure,
    });

    await runtime.dispatch({
      occurrenceId: "workflow.closed:/repo:task-1:event-1",
      kind: "workflow.closed",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build notifications" },
      status: "Task moved to Closed.",
      navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
    });

    expect(showOsNotification).not.toHaveBeenCalled();
    expect(withExternalDeliveryOwnership).toHaveBeenCalledWith(
      "workflow.closed:/repo:task-1:event-1",
      expect.any(Function),
    );
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("keeps local delivery when the browser focus state cannot be read", async () => {
    const loadSettings = mock(async () => {
      const settings = createDefaultNotificationSettings();
      settings.volumePercent = 0;
      return settings;
    });
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        isAppFocused: async () => {
          throw new Error("Focus lock query failed.");
        },
        showOsNotification,
      }),
      loadSettings,
      navigate: async () => {},
      onFailure,
    });

    await runtime.dispatch({
      occurrenceId: "workflow.closed:/repo:task-1:event-focus-failure",
      kind: "workflow.closed",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build notifications" },
      status: "Task moved to Closed.",
      navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
    });

    expect(loadSettings).toHaveBeenCalledTimes(1);
    expect(showOsNotification).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith({
      channel: "os",
      kind: "workflow.closed",
      occurrenceId: "workflow.closed:/repo:task-1:event-focus-failure",
      repoPath: "/repo",
      message: "Focus lock query failed.",
    });
  });
});
