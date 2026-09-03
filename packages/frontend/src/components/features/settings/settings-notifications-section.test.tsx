import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  NOTIFICATION_KIND_VALUES,
} from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  openSystemSettings: async () => {},
  previewCue: async () => {},
  testInApp: async () => {},
  testOs: async () => ({ status: "shown" }),
  registerNavigator: () => () => {},
  sessionStartNotifications: {
    publishSessionStarted: () => {},
    publishSessionError: async () => true,
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
    await screen.findByText(
      "OS notifications are not enabled yet. Test OS to choose whether to allow them.",
    );

    const sectionText = document.body.textContent ?? "";
    expect(sectionText).not.toContain("Status and tests");
    expect(sectionText.indexOf("Test notifications")).toBeLessThan(
      sectionText.indexOf("Sound and focus"),
    );

    expect(screen.getAllByRole("switch")).toHaveLength(NOTIFICATION_KIND_VALUES.length);
    const delivery = screen.getByRole("radiogroup", {
      name: "Delivery for Permission Prompt",
    });
    expect(delivery.getAttribute("data-variant")).toBe("segmented");
    expect(
      within(delivery)
        .getAllByRole("radio")
        .every((radio) => radio.getAttribute("data-slot") === "radio-group-segment-item"),
    ).toBe(true);
    expect(within(delivery).getByRole("radio", { name: "Both" }).getAttribute("data-state")).toBe(
      "checked",
    );
    fireEvent.click(within(delivery).getByRole("radio", { name: "OS" }));
    expect(within(delivery).getByRole("radio", { name: "OS" }).getAttribute("data-state")).toBe(
      "checked",
    );
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

  test("opens system settings and rechecks denied Electron notification permission", async () => {
    const openSystemSettings = mock(async () => {});
    let capabilityChecks = 0;
    const getCapability = mock(async () => {
      capabilityChecks += 1;
      return {
        platform: "electron" as const,
        supported: true,
        permission: capabilityChecks === 1 ? ("denied" as const) : ("granted" as const),
        canGuaranteeSilent: true,
      };
    });
    const testOs = mock(async () => ({ status: "shown" as const }));
    render(
      <NotificationsHarness
        context={createNotificationContext({
          getCapability,
          openSystemSettings,
          testOs,
        })}
      />,
    );

    const description = await screen.findByText(
      "OS notifications are disabled in system settings. Allow OpenDucktor notifications to receive alerts outside the app.",
    );
    const permissionAlert = description.closest("[role='alert']");
    expect(permissionAlert).not.toBeNull();
    expect(permissionAlert?.className).toContain("bg-warning-surface");
    expect(permissionAlert?.textContent).toContain("OS notifications are off");
    const testOsButton = screen.getByRole("button", { name: "Test OS" });
    expect(testOsButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Open system settings" }));
    await waitFor(() => expect(openSystemSettings).toHaveBeenCalledTimes(1));

    fireEvent.click(testOsButton);
    await waitFor(() => expect(testOs).toHaveBeenCalledTimes(1));
    await screen.findByText(
      "OS notifications are enabled. OpenDucktor can send alerts outside the app.",
    );
    expect(getCapability).toHaveBeenCalledTimes(2);
  });

  test("explains when OS notifications are enabled", async () => {
    render(
      <NotificationsHarness
        context={createNotificationContext({
          getCapability: async () => ({
            platform: "electron",
            supported: true,
            permission: "granted",
            canGuaranteeSilent: true,
          }),
        })}
      />,
    );

    const description = await screen.findByText(
      "OS notifications are enabled. OpenDucktor can send alerts outside the app.",
    );
    const permissionStatus = description.closest("[role='status']");
    expect(permissionStatus).not.toBeNull();
    expect(permissionStatus?.className).toContain("bg-success-surface");
    expect(permissionStatus?.textContent).toContain("OS notifications are on");
    expect(screen.queryByRole("button", { name: "Open system settings" })).toBeNull();
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

    await screen.findByText(
      "OS notifications are not enabled yet. Test OS to choose whether to allow them.",
    );
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
