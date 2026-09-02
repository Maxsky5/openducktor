import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  NOTIFICATION_KIND_VALUES,
} from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type ReactElement, useState } from "react";
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
    expect(screen.getByRole("group", { name: "Delivery for Permission Prompt" })).not.toBeNull();
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
      failureMessage: "Browser notification coordination failed: Lock snapshot failed.",
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
    const testOsButton = screen.getByRole("button", { name: "Test OS" });
    expect(testOsButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(testOsButton);
    await waitFor(() => expect(testOs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCapability).toHaveBeenCalledTimes(2));
  });

  test("uses a slider for volume", async () => {
    render(<NotificationsHarness context={createNotificationContext()} />);

    const volume = screen.getByRole("slider", { name: "Volume" });
    expect(volume.getAttribute("aria-valuenow")).toBe("30");

    fireEvent.keyDown(volume, { key: "ArrowRight" });
    expect(volume.getAttribute("aria-valuenow")).toBe("31");
  });

  test("previews a row sound from the dropdown without selecting it", async () => {
    const previewCue = mock(async () => {});
    render(<NotificationsHarness context={createNotificationContext({ previewCue })} />);

    await screen.findByText("Permission will be requested only when you test OS notifications.");
    const soundPicker = screen.getByRole("button", { name: "Sound for Permission Prompt" });
    expect(soundPicker.textContent).toContain("Use global sound");

    await act(async () => {
      fireEvent.click(soundPicker);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview Sparkle" }));
    });

    expect(previewCue).toHaveBeenCalledWith("sparkle", 30);
    expect(soundPicker.textContent).toContain("Use global sound");
  });
});
