import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  NOTIFICATION_KIND_VALUES,
} from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { QueryProvider } from "@/lib/query-provider";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import { SettingsNotificationsSection } from "./settings-notifications-section";

afterEach(cleanup);

const createNotificationContext = (
  overrides: Partial<NotificationContextValue> = {},
): NotificationContextValue => ({
  osFailure: null,
  getCapability: async () => ({
    platform: "browser",
    supported: true,
    permission: "prompt",
    canGuaranteeSilent: true,
  }),
  previewCue: async () => {},
  testInApp: async () => {},
  testOs: async () => ({ status: "shown" }),
  registerNavigator: () => () => {},
  sessionStartNotifications: {
    publishSessionStarted: () => {},
    publishSessionError: () => {},
    reportFailure: () => {},
  },
  taskStreamSink: {
    onChange: async () => {},
    onSnapshot: async () => {},
    onFailure: () => {},
  },
  ...overrides,
});

function NotificationsHarness({ context }: { context: NotificationContextValue }): ReactElement {
  const [settings, setSettings] = useState(createDefaultNotificationSettings);
  return (
    <QueryProvider useIsolatedClient>
      <NotificationContext.Provider value={context}>
        <SettingsNotificationsSection
          notifications={settings}
          disabled={false}
          onUpdateNotifications={(updater) => setSettings(updater)}
        />
      </NotificationContext.Provider>
    </QueryProvider>
  );
}

describe("SettingsNotificationsSection", () => {
  test("renders every notification kind and retains disabled row choices", async () => {
    render(<NotificationsHarness context={createNotificationContext()} />);
    await screen.findByText("Permission will be requested only when you test OS notifications.");

    expect(screen.getAllByRole("switch")).toHaveLength(NOTIFICATION_KIND_VALUES.length);
    const idleSwitch = screen.getByRole("switch", { name: "Enable Agent Session Idle" });
    expect(idleSwitch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(idleSwitch);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(idleSwitch);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByText("Both").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Use global sound").length).toBeGreaterThan(0);
  });

  test("tests each channel only from an explicit button click", async () => {
    const getCapability = mock(async () => ({
      platform: "browser" as const,
      supported: true,
      permission: "prompt" as const,
      canGuaranteeSilent: true,
    }));
    const testInApp = mock(async () => {});
    const testOs = mock(async () => ({ status: "shown" as const }));
    render(
      <NotificationsHarness
        context={createNotificationContext({ getCapability, testInApp, testOs })}
      />,
    );

    expect(testInApp).not.toHaveBeenCalled();
    expect(testOs).not.toHaveBeenCalled();
    await waitFor(() => expect(getCapability).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Test in-app" }));
    await waitFor(() => expect(testInApp).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Test OS" }));
    await waitFor(() => expect(testOs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCapability).toHaveBeenCalledTimes(2));
  });

  test("previews an inherited row sound with the draft global cue and volume", async () => {
    const previewCue = mock(async () => {});
    render(<NotificationsHarness context={createNotificationContext({ previewCue })} />);

    await screen.findByText("Permission will be requested only when you test OS notifications.");
    fireEvent.click(screen.getByRole("button", { name: "Preview Permission Prompt sound" }));

    expect(previewCue).toHaveBeenCalledWith("chime", 30);
  });
});
