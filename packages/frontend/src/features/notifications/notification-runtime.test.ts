import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOccurrence,
  type NotificationOsDeliveryRequest,
  type NotificationSettings,
} from "@openducktor/contracts";
import type { NotificationBridge } from "@/lib/shell-bridge";
import { createNotificationRuntime as createProductionNotificationRuntime } from "./notification-runtime";

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
  publishOccurrence: async (occurrence, settings) => ({ occurrence, settings }),
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

type RuntimeOptions = Parameters<typeof createProductionNotificationRuntime>[0];
type TestRuntimeOptions = Omit<RuntimeOptions, "inApp" | "sound" | "onCoordinationRecovered"> &
  Partial<Pick<RuntimeOptions, "inApp" | "sound" | "onCoordinationRecovered">>;

const createNotificationRuntime = (options: TestRuntimeOptions) => {
  const delivery = createDeliveryAdapters();
  return createProductionNotificationRuntime({
    inApp: delivery.inApp,
    sound: delivery.sound,
    onCoordinationRecovered: () => {},
    ...options,
  });
};

describe("notification runtime tests", () => {
  test("bounds display text before publishing the occurrence", async () => {
    let resolvePublished = (_occurrence: NotificationOccurrence): void => {};
    const publishedOccurrence = new Promise<NotificationOccurrence>((resolve) => {
      resolvePublished = resolve;
    });
    const publishOccurrence = mock(
      async (published: NotificationOccurrence, settings: NotificationSettings) => {
        resolvePublished(published);
        return { occurrence: published, settings };
      },
    );
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

    const published = await publishedOccurrence;
    expect(published?.repositoryLabel).toHaveLength(120);
    expect(published?.task?.title).toHaveLength(240);
    expect(published?.sessionLabel).toHaveLength(120);
  });

  test("publishes the settings snapshot selected for the occurrence", async () => {
    const settings = createDefaultNotificationSettings();
    settings.kinds["workflow.closed"] = { enabled: true, target: "in_app", sound: "none" };
    let resolvePublished = (_settings: NotificationSettings | undefined): void => {};
    const published = new Promise<NotificationSettings | undefined>((resolve) => {
      resolvePublished = resolve;
    });
    const publishOccurrence = mock(
      async (occurrence: NotificationOccurrence, publishedSettings: NotificationSettings) => {
        resolvePublished(publishedSettings);
        return { occurrence, settings: publishedSettings };
      },
    );
    const delivery = createDeliveryAdapters();
    const runtime = createNotificationRuntime({
      bridge: createBridge({ publishOccurrence }),
      loadSettings: async () => settings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    runtime.publish(workflowClosedOccurrence("event-settings-snapshot"));

    expect(await published).toEqual(settings);
  });

  test("uses one settings snapshot when another tab receives the occurrence", async () => {
    let receiveOccurrence:
      | ((occurrence: NotificationOccurrence, settings: NotificationSettings) => void)
      | null = null;
    let resolveDelivery = (): void => {};
    const delivered = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const recipientInApp = mock(async () => resolveDelivery());
    const recipientLoadSettings = mock(async () => {
      const settings = createDefaultNotificationSettings();
      settings.kinds["workflow.closed"].enabled = false;
      return settings;
    });
    const recipient = createNotificationRuntime({
      bridge: createBridge({
        subscribeOccurrences(listener) {
          receiveOccurrence = listener;
          return () => {};
        },
      }),
      loadSettings: recipientLoadSettings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: { deliver: recipientInApp },
      sound: { play: async () => {} },
    });
    recipient.subscribe();

    const publisherSettings = createDefaultNotificationSettings();
    publisherSettings.kinds["workflow.closed"] = {
      enabled: true,
      target: "in_app",
      sound: "none",
    };
    const publisherDelivery = createDeliveryAdapters();
    const publisher = createNotificationRuntime({
      bridge: createBridge({
        async publishOccurrence(occurrence, settings) {
          receiveOccurrence?.(occurrence, settings);
          return { occurrence, settings };
        },
      }),
      loadSettings: async () => publisherSettings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: publisherDelivery.inApp,
      sound: publisherDelivery.sound,
    });

    publisher.publish(workflowClosedOccurrence("event-two-tabs"));
    await delivered;

    expect(recipientInApp).toHaveBeenCalledTimes(1);
    expect(recipientLoadSettings).not.toHaveBeenCalled();
  });

  test("uses the settings snapshot selected by publication", async () => {
    const candidateSettings = createDefaultNotificationSettings();
    candidateSettings.kinds["workflow.closed"].enabled = false;
    const selectedSettings = createDefaultNotificationSettings();
    selectedSettings.kinds["workflow.closed"] = {
      enabled: true,
      target: "in_app",
      sound: "none",
    };
    let resolveDelivery = (): void => {};
    const delivered = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const deliverInApp = mock(async () => resolveDelivery());
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        publishOccurrence: async (occurrence) => ({
          occurrence,
          settings: selectedSettings,
        }),
      }),
      loadSettings: async () => candidateSettings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: { deliver: deliverInApp },
      sound: { play: async () => {} },
    });

    runtime.publish(workflowClosedOccurrence("event-selected-settings"));
    await delivered;

    expect(deliverInApp).toHaveBeenCalledTimes(1);
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

  test("reports recovery after a later healthy coordination cycle", async () => {
    let attempt = 0;
    const onCoordinationRecovered = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => {
          attempt += 1;
          if (attempt === 1) {
            throw new Error("Claim propagation failed.");
          }
          await dispatch(true);
        },
      }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
      onCoordinationRecovered,
    });
    const occurrence = workflowClosedOccurrence("event-coordination-recovery");

    await runtime.dispatch(occurrence);
    expect(onCoordinationRecovered).not.toHaveBeenCalled();
    await runtime.dispatch(occurrence);

    expect(onCoordinationRecovered).toHaveBeenCalledTimes(1);
  });

  test("reports publication recovery after a later non-owner publication succeeds", async () => {
    let publishAttempt = 0;
    let resolveFailure = (): void => {};
    const failed = new Promise<void>((resolve) => {
      resolveFailure = resolve;
    });
    let resolveDelivery = (): void => {};
    const delivered = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const onCoordinationRecovered = mock(() => {});
    const onFailure = mock(() => resolveFailure());
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        async publishOccurrence(publishedOccurrence, publishedSettings) {
          publishAttempt += 1;
          if (publishAttempt === 1) {
            throw new Error("Occurrence publication failed.");
          }
          return { occurrence: publishedOccurrence, settings: publishedSettings };
        },
        withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => dispatch(false),
      }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure,
      onCoordinationRecovered,
      inApp: { deliver: async () => resolveDelivery() },
      sound: { play: async () => {} },
    });

    runtime.publish(workflowClosedOccurrence("event-publication-failure"));
    await failed;
    expect(onFailure).toHaveBeenCalledWith({
      channel: "coordination",
      kind: "workflow.closed",
      occurrenceId: "workflow.closed:/repo:task-1:event-publication-failure",
      repoPath: "/repo",
      message: "Occurrence publication failed.",
    });
    runtime.publish(workflowClosedOccurrence("event-publication-recovery"));
    await delivered;

    expect(onCoordinationRecovered).toHaveBeenCalledTimes(1);
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

  test("does not coordinate an occurrence again after external delivery is complete", async () => {
    const delivery = createDeliveryAdapters();
    const isAppFocused = mock(async () => false);
    const withExternalDeliveryOwnership = mock(
      async (_occurrenceId: string, dispatch: (owner: boolean) => Promise<void>) => dispatch(true),
    );
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({ isAppFocused, withExternalDeliveryOwnership }),
      loadSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });
    const occurrence = workflowClosedOccurrence("event-complete");

    await runtime.dispatch(occurrence);
    isAppFocused.mockImplementation(async () => {
      throw new Error("Late focus failure.");
    });
    await runtime.dispatch(occurrence);

    expect(withExternalDeliveryOwnership).toHaveBeenCalledTimes(1);
    expect(isAppFocused).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
