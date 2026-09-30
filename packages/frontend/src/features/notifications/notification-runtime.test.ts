import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOsDeliveryRequest,
} from "@openducktor/contracts";
import {
  createBridge,
  createDeliveryAdapters,
  createNotificationRuntime,
  workflowClosedOccurrence,
} from "./notification-runtime.test-support";

describe("notification delivery and previews", () => {
  test("reports sound failures independently and signals recovery after a preview", async () => {
    const onFailure = mock(() => {});
    const onSoundPlayed = mock(() => {});
    let fail = true;
    const inApp = { deliver: mock(async () => {}) };
    const runtime = createNotificationRuntime({
      bridge: createBridge(),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure,
      onSoundPlayed,
      inApp,
      sound: {
        play: async () => {
          if (fail) throw new Error("Audio unavailable");
        },
      },
    });
    await runtime.publishAndWait(workflowClosedOccurrence("sound-failure"));
    expect(inApp.deliver).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ channel: "sound" }));
    expect(onSoundPlayed).not.toHaveBeenCalled();
    fail = false;
    await runtime.previewCue("chime", 30);
    expect(onSoundPlayed).toHaveBeenCalledTimes(1);
  });

  test("uses the settings navigation target in both explicit tests", async () => {
    const inApp = { deliver: mock(async () => {}) };
    const showOsNotification = mock(async () => ({ status: "shown" as const }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({ showOsNotification }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
      inApp,
    });
    await runtime.testInApp(createDefaultNotificationSettings());
    await runtime.testOs(createDefaultNotificationSettings());
    expect(inApp.deliver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ navigationTarget: { type: "notification_settings" } }),
    );
    expect(showOsNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "test",
        navigationTarget: { type: "notification_settings" },
      }),
    );
  });

  test.each(["disabled", "os", "failed"] as const)(
    "does not claim local error feedback for %s delivery",
    async (mode) => {
      const settings = createDefaultNotificationSettings();
      settings.kinds["agent.session_error"].enabled = mode !== "disabled";
      settings.kinds["agent.session_error"].target = mode === "os" ? "os" : "in_app";
      const inApp = {
        deliver: mock(async () => {
          throw new Error("Toast failed");
        }),
      };
      const runtime = createNotificationRuntime({
        bridge: createBridge(),
        selectSettings: async () => settings,
        navigate: async () => {},
        onFailure: () => {},
        inApp,
      });
      expect(
        await runtime.publishAndWait(
          { ...workflowClosedOccurrence(mode), kind: "agent.session_error" },
          "Set the runtime executable path.",
        ),
      ).toBe(false);
      expect(inApp.deliver).toHaveBeenCalledTimes(mode === "failed" ? 1 : 0);
    },
  );

  test("reports no in-app feedback when the notification kind is disabled", async () => {
    const settings = createDefaultNotificationSettings();
    settings.kinds["workflow.closed"].enabled = false;
    const delivery = createDeliveryAdapters();
    const runtime = createNotificationRuntime({
      bridge: createBridge(),
      selectSettings: async () => settings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    const inAppDelivered = await runtime.publishAndWait(
      workflowClosedOccurrence("event-disabled-feedback"),
    );

    expect(inAppDelivered).toBe(false);
    expect(delivery.deliverInApp).not.toHaveBeenCalled();
  });

  test("reports confirmed in-app feedback after delivery", async () => {
    const settings = createDefaultNotificationSettings();
    settings.kinds["workflow.closed"] = {
      enabled: true,
      target: "in_app",
      sound: "none",
    };
    const runtime = createNotificationRuntime({
      bridge: createBridge(),
      selectSettings: async () => settings,
      navigate: async () => {},
      onFailure: () => {},
    });

    const inAppDelivered = await runtime.publishAndWait(
      workflowClosedOccurrence("event-in-app-feedback"),
    );

    expect(inAppDelivered).toBe(true);
  });

  test("reports no in-app feedback when delivery fails", async () => {
    const settings = createDefaultNotificationSettings();
    settings.kinds["workflow.closed"] = {
      enabled: true,
      target: "in_app",
      sound: "none",
    };
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge(),
      selectSettings: async () => settings,
      navigate: async () => {},
      onFailure,
      inApp: { deliver: async () => Promise.reject(new Error("toast failed")) },
    });

    const inAppDelivered = await runtime.publishAndWait(
      workflowClosedOccurrence("event-in-app-failure"),
    );

    expect(inAppDelivered).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "in_app", message: "toast failed" }),
    );
  });

  test("requests permission only from the explicit OS test", async () => {
    const requestPermission = mock(async () => ({
      platform: "browser" as const,
      supported: true,
      permission: "granted" as const,
      canGuaranteeSilent: true,
      canOpenSystemSettings: false,
    }));
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({ requestPermission, showOsNotification }),
      selectSettings: async () => createDefaultNotificationSettings(),
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
          canOpenSystemSettings: false,
        }),
        showOsNotification,
      }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
    });

    const result = await runtime.testOs(createDefaultNotificationSettings());
    expect(result.status).toBe("denied");
    expect(showOsNotification).not.toHaveBeenCalled();
  });

  test("keeps local delivery when the browser focus state cannot be read", async () => {
    const delivery = createDeliveryAdapters();
    const selectSettings = mock(async () => {
      const settings = createDefaultNotificationSettings();
      settings.volumePercent = 0;
      settings.kinds["workflow.closed"].target = "both";
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
      selectSettings,
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.publishAndWait({
      occurrenceId: "workflow.closed:/repo:task-1:event-focus-failure",
      kind: "workflow.closed",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build notifications" },
      status: "Task moved to Closed.",
      navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
    });

    expect(selectSettings).toHaveBeenCalledTimes(1);
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
      selectSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.kinds["workflow.closed"].enabled = false;
        return settings;
      },
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.publishAndWait(workflowClosedOccurrence("event-disabled"));

    expect(delivery.deliverInApp).not.toHaveBeenCalled();
    expect(withExternalDeliveryOwnership).not.toHaveBeenCalled();
    expect(isAppFocused).not.toHaveBeenCalled();
  });

  test.each([
    ["none", 30],
    ["inherit", 0],
  ] as const)(
    "does not coordinate an in-app notice with cue %s at volume %s",
    async (sound, volumePercent) => {
      const delivery = createDeliveryAdapters();
      const withExternalDeliveryOwnership = mock(
        async (_occurrenceId: string, dispatch: (owner: boolean) => Promise<void>) =>
          dispatch(true),
      );
      const isAppFocused = mock(async () => false);
      const runtime = createNotificationRuntime({
        bridge: createBridge({ withExternalDeliveryOwnership, isAppFocused }),
        selectSettings: async () => {
          const settings = createDefaultNotificationSettings();
          settings.kinds["workflow.closed"] = {
            enabled: true,
            target: "in_app",
            sound,
          };
          settings.volumePercent = volumePercent;
          return settings;
        },
        navigate: async () => {},
        onFailure: () => {},
        inApp: delivery.inApp,
        sound: delivery.sound,
      });

      await runtime.publishAndWait(workflowClosedOccurrence("event-local-only"));

      expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
      expect(withExternalDeliveryOwnership).not.toHaveBeenCalled();
      expect(isAppFocused).not.toHaveBeenCalled();
      expect(delivery.playSound).not.toHaveBeenCalled();
    },
  );

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
      selectSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.osFocus = "always_send";
        settings.kinds["workflow.closed"].target = "both";
        settings.kinds["workflow.closed"].sound = "none";
        return settings;
      },
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.publishAndWait(workflowClosedOccurrence("event-always-os"));

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
      selectSettings: async () => {
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

    await runtime.publishAndWait(workflowClosedOccurrence("event-always-sound"));

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
      selectSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.osFocus = "always_send";
        settings.soundFocus = "mute_while_focused";
        settings.kinds["workflow.closed"].target = "both";
        return settings;
      },
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.publishAndWait(workflowClosedOccurrence("event-partial-focus-failure"));

    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(delivery.playSound).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "coordination", message: "Focus lock query failed." }),
    );
  });
});
