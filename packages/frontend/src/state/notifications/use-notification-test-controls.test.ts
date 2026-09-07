import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOsCapability,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren } from "react";
import { createNotificationRuntime } from "@/features/notifications/notification-runtime";
import { QueryProvider } from "@/lib/query-provider";
import type { NotificationBridge } from "@/lib/shell-bridge";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { NotificationContext, type NotificationContextValue } from "./notification-context";
import {
  describeNotificationOsCapability,
  useNotificationTestControls,
} from "./use-notification-test-controls";

const capability = (
  overrides: Partial<NotificationOsCapability> = {},
): NotificationOsCapability => ({
  platform: "browser",
  supported: true,
  permission: "granted",
  canGuaranteeSilent: true,
  canOpenSystemSettings: false,
  ...overrides,
});

test.each([
  { target: "os", soundFails: true, permission: "granted" },
  { target: "os", soundFails: false, permission: "granted" },
  { target: "os", soundFails: false, permission: "denied" },
  { target: "in_app", soundFails: false, permission: "granted" },
] as const)(
  "refreshes permission after $target with soundFails=$soundFails and permission=$permission",
  async ({ target, soundFails, permission }) => {
    let currentCapability = capability({ permission: "prompt" });
    const getCapability = mock(async () => currentCapability);
    const showOsNotification = mock(async () => ({ status: "shown" as const }));
    const bridge: NotificationBridge = {
      getCapability,
      requestPermission: async () => {
        currentCapability = capability({ permission });
        return currentCapability;
      },
      showOsNotification,
      openSystemSettings: async () => {},
      isAppFocused: async () => false,
      withExternalDeliveryOwnership: async (_id, dispatch) => dispatch(true),
      publishOccurrence: async (occurrence, settings) => ({ occurrence, settings }),
      subscribeOccurrences: () => () => {},
      subscribeClicks: () => () => {},
      dispose: () => {},
    };
    const settings = { ...createDefaultNotificationSettings(), volumePercent: 50 };
    const runtime = createNotificationRuntime({
      bridge,
      loadSettings: async () => settings,
      navigate: async () => {},
      onFailure: () => {},
      onCoordinationRecovered: () => {},
      inApp: { deliver: async () => {} },
      sound: {
        play: async () => {
          if (soundFails) throw new Error("Sound failed.");
        },
      },
    });
    const context: NotificationContextValue = {
      ...runtime,
      deliveryFailure: null,
      registerNavigator: () => () => {},
      sessionStartNotifications: {
        publishSessionStarted: () => {},
        publishSessionError: async () => false,
        reportFailure: () => {},
      },
      taskStreamSink: {
        onChange: async () => {},
        onSnapshot: async () => {},
        onFailure: () => {},
      },
    };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(NotificationContext.Provider, { value: context }, children),
      );
    const harness = createHookHarness(useNotificationTestControls, settings, { wrapper });
    try {
      await harness.mount();
      await harness.waitFor((state) => state.capability?.permission === "prompt");
      const initialReads = getCapability.mock.calls.length;
      await harness.run((state) => state.testNotification(target));
      expect(getCapability).toHaveBeenCalledTimes(initialReads + (target === "os" ? 1 : 0));
      await harness.waitFor(
        (state) =>
          !state.isTesting && (target === "in_app" || state.capability?.permission === permission),
      );
      const state = harness.getLatest();
      expect(showOsNotification).toHaveBeenCalledTimes(
        target === "os" && permission === "granted" ? 1 : 0,
      );
      if (soundFails) {
        expect(state.status).toBe("Sound failed.");
        expect(state.capabilityDescription).toBe(
          "OS notifications are enabled. OpenDucktor can send alerts outside the app.",
        );
      } else if (target === "in_app") {
        expect(state.status).toBe("In-app test sent.");
      } else {
        expect(state.status).toBe(
          permission === "granted" ? "OS test sent." : "OS notification permission was denied.",
        );
      }
    } finally {
      await harness.unmount();
    }
  },
);

describe("notification OS capability description", () => {
  test("distinguishes denied permission from available delivery", () => {
    expect(describeNotificationOsCapability(capability({ permission: "denied" }), null)).toBe(
      "OS notifications are disabled in browser settings. Allow notifications for OpenDucktor to receive alerts outside the app.",
    );
    expect(
      describeNotificationOsCapability(
        capability({ platform: "electron", permission: "denied" }),
        null,
      ),
    ).toBe(
      "OS notifications are disabled in system settings. Allow OpenDucktor notifications to receive alerts outside the app.",
    );
    expect(describeNotificationOsCapability(capability(), null)).toBe(
      "OS notifications are enabled. OpenDucktor can send alerts outside the app.",
    );
    expect(describeNotificationOsCapability(capability({ permission: "prompt" }), null)).toBe(
      "OS notifications are not enabled yet. Test OS to choose whether to allow them.",
    );
  });

  test("shows an actionable query error", () => {
    expect(describeNotificationOsCapability(undefined, new Error("Capability check failed."))).toBe(
      "Capability check failed.",
    );
  });

  test("shows the latest delivery failure instead of reporting ready", () => {
    expect(
      describeNotificationOsCapability(
        capability({ failureMessage: "The native notification service failed." }),
        null,
      ),
    ).toBe("The native notification service failed.");
  });
});
