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

const workflowClosedOccurrence = (suffix: string): NotificationOccurrence => ({
  occurrenceId: `workflow.closed:/repo:task-1:${suffix}`,
  kind: "workflow.closed",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  status: "Task moved to Closed.",
  navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
});

const createDeliveryAdapters = () => {
  const deliverInApp = mock(async () => {});
  const playSound = mock(async () => {});
  return {
    deliverInApp,
    playSound,
    inApp: { deliver: deliverInApp },
    sound: { play: playSound },
  };
};

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

  test("keeps the local toast when browser ownership fails", async () => {
    const delivery = createDeliveryAdapters();
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        withExternalDeliveryOwnership: async () => {
          throw new Error("Claim propagation failed.");
        },
        showOsNotification,
      }),
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.volumePercent = 0;
        return settings;
      },
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.dispatch(workflowClosedOccurrence("event-claim-failure"));

    expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
    expect(showOsNotification).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith({
      channel: "coordination",
      kind: "workflow.closed",
      occurrenceId: "workflow.closed:/repo:task-1:event-claim-failure",
      repoPath: "/repo",
      message: "Claim propagation failed.",
    });
  });

  test("uses current focus when a later dispatch owns external delivery", async () => {
    const delivery = createDeliveryAdapters();
    const owners = [false, true];
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        isAppFocused: async () => true,
        withExternalDeliveryOwnership: async (_occurrenceId, dispatch) =>
          dispatch(owners.shift() ?? false),
        showOsNotification,
      }),
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.volumePercent = 0;
        return settings;
      },
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    const occurrence = workflowClosedOccurrence("event-owner-handoff");
    await runtime.dispatch(occurrence);
    await runtime.dispatch(occurrence);

    expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
    expect(showOsNotification).not.toHaveBeenCalled();
  });

  test("keeps local delivery when the browser focus state cannot be read", async () => {
    const delivery = createDeliveryAdapters();
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
      inApp: delivery.inApp,
      sound: delivery.sound,
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
    expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
    expect(showOsNotification).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith({
      channel: "coordination",
      kind: "workflow.closed",
      occurrenceId: "workflow.closed:/repo:task-1:event-focus-failure",
      repoPath: "/repo",
      message: "Focus lock query failed.",
    });
  });

  test("does not claim external delivery when the kind is disabled", async () => {
    const delivery = createDeliveryAdapters();
    const withExternalDeliveryOwnership = mock(
      async (_occurrenceId: string, dispatch: (owner: boolean) => Promise<void>) => dispatch(true),
    );
    const isAppFocused = mock(async () => false);
    const runtime = createNotificationRuntime({
      bridge: createBridge({ withExternalDeliveryOwnership, isAppFocused }),
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.kinds["workflow.closed"].enabled = false;
        return settings;
      },
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.dispatch(workflowClosedOccurrence("event-disabled"));

    expect(delivery.deliverInApp).not.toHaveBeenCalled();
    expect(withExternalDeliveryOwnership).not.toHaveBeenCalled();
    expect(isAppFocused).not.toHaveBeenCalled();
  });

  test("does not claim external delivery for an in-app notice without sound", async () => {
    const delivery = createDeliveryAdapters();
    const withExternalDeliveryOwnership = mock(
      async (_occurrenceId: string, dispatch: (owner: boolean) => Promise<void>) => dispatch(true),
    );
    const isAppFocused = mock(async () => false);
    const runtime = createNotificationRuntime({
      bridge: createBridge({ withExternalDeliveryOwnership, isAppFocused }),
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.kinds["workflow.closed"] = {
          enabled: true,
          target: "in_app",
          sound: "none",
        };
        return settings;
      },
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.dispatch(workflowClosedOccurrence("event-local-only"));

    expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
    expect(withExternalDeliveryOwnership).not.toHaveBeenCalled();
    expect(isAppFocused).not.toHaveBeenCalled();
  });

  test("sends always-send OS notices without reading focus", async () => {
    const delivery = createDeliveryAdapters();
    const isAppFocused = mock(async () => {
      throw new Error("Focus lock query failed.");
    });
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({ isAppFocused, showOsNotification }),
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.osFocus = "always_send";
        settings.kinds["workflow.closed"].sound = "none";
        return settings;
      },
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.dispatch(workflowClosedOccurrence("event-always-os"));

    expect(isAppFocused).not.toHaveBeenCalled();
    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("plays always-play sounds without reading focus", async () => {
    const delivery = createDeliveryAdapters();
    const isAppFocused = mock(async () => {
      throw new Error("Focus lock query failed.");
    });
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({ isAppFocused }),
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.soundFocus = "always_play";
        settings.kinds["workflow.closed"].target = "in_app";
        return settings;
      },
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.dispatch(workflowClosedOccurrence("event-always-sound"));

    expect(isAppFocused).not.toHaveBeenCalled();
    expect(delivery.playSound).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("keeps always-send OS delivery when focus-dependent sound cannot read focus", async () => {
    const delivery = createDeliveryAdapters();
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
      loadSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.osFocus = "always_send";
        settings.soundFocus = "mute_while_focused";
        return settings;
      },
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.dispatch(workflowClosedOccurrence("event-partial-focus-failure"));

    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(delivery.playSound).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "coordination", message: "Focus lock query failed." }),
    );
  });
});
