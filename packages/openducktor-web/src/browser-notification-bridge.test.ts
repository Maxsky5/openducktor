import { describe, expect, mock, test } from "bun:test";
import type {
  NotificationClickEvent,
  NotificationOccurrence,
  NotificationSettings,
} from "@openducktor/contracts";
import {
  type BrowserNotificationConstructor,
  type BrowserNotificationInstance,
  createBrowserNotificationBridge,
} from "./browser-notification-bridge";

const occurrence: NotificationOccurrence = {
  occurrenceId: "workflow.closed:/repo:task-1:event-1",
  kind: "workflow.closed",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  status: "Task moved to Closed.",
  navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
};

const createCoordinator = () => ({
  supported: true,
  getFailureMessage: mock((): string | null => null),
  publishOccurrence: mock(
    (_occurrence: NotificationOccurrence, _settings: NotificationSettings) => {},
  ),
  subscribeOccurrences: mock(
    (_listener: (value: NotificationOccurrence, settings: NotificationSettings) => void) =>
      () => {},
  ),
  isExternalDeliveryOwner: mock(() => true),
  claimExternalDelivery: mock(async (_occurrenceId: string) => true),
  isAnyTabFocused: mock(async () => false),
  dispose: mock(() => {}),
});

describe("browser notification bridge", () => {
  test("claims external delivery before dispatch starts", async () => {
    const coordinator = createCoordinator();
    const bridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator,
      focusWindow: () => {},
    });
    const expected = new Error("delivery failed");

    await expect(
      bridge.withExternalDeliveryOwnership(occurrence.occurrenceId, async (owner) => {
        expect(coordinator.claimExternalDelivery).toHaveBeenCalledWith(occurrence.occurrenceId);
        expect(owner).toBe(true);
        throw expected;
      }),
    ).rejects.toBe(expected);
  });

  test("does not request permission until the explicit action", async () => {
    let permission: NotificationPermission = "default";
    const requestPermission = mock(async () => {
      permission = "granted";
      return permission;
    });
    class TestNotification implements BrowserNotificationInstance {
      static get permission(): NotificationPermission {
        return permission;
      }
      static requestPermission = requestPermission;
      onclick: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onshow: ((event: Event) => void) | null = null;
      silent: boolean | null = null;
      close(): void {}
      constructor(_title: string, _options?: NotificationOptions) {}
    }
    const NativeNotification: BrowserNotificationConstructor = TestNotification;
    const bridge = createBrowserNotificationBridge({
      NativeNotification,
      coordinator: createCoordinator(),
      canGuaranteeSilent: true,
      focusWindow: () => {},
    });

    expect(await bridge.getCapability()).toMatchObject({
      platform: "browser",
      supported: true,
      permission: "prompt",
    });
    expect(requestPermission).not.toHaveBeenCalled();

    expect(await bridge.requestPermission()).toMatchObject({ permission: "granted" });
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  test("keeps a coordination failure after unrelated OS delivery succeeds", async () => {
    const failureMessage: string | null = "Lock snapshot failed.";
    const coordinator = createCoordinator();
    coordinator.getFailureMessage.mockImplementation(() => failureMessage);
    const instances: BrowserNotificationInstance[] = [];
    class TestNotification implements BrowserNotificationInstance {
      static permission: NotificationPermission = "granted";
      static requestPermission = async (): Promise<NotificationPermission> => "granted";
      onclick: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onshow: ((event: Event) => void) | null = null;
      silent: boolean | null = null;
      close(): void {}
      constructor(_title: string, _options?: NotificationOptions) {
        instances.push(this);
      }
    }
    const bridge = createBrowserNotificationBridge({
      NativeNotification: TestNotification,
      coordinator,
      canGuaranteeSilent: true,
      focusWindow: () => {},
    });

    expect(await bridge.getCapability()).toEqual({
      platform: "browser",
      supported: true,
      permission: "granted",
      canGuaranteeSilent: true,
      failureMessage: "Browser notification coordination failed: Lock snapshot failed.",
    });

    const delivery = bridge.showOsNotification({
      occurrenceId: occurrence.occurrenceId,
      title: "Notifications are working",
      body: "This is an OS notification test.",
      silent: true,
      navigationTarget: occurrence.navigationTarget,
    });
    await Promise.resolve();
    instances[0]?.onshow?.(new Event("show"));

    await expect(delivery).resolves.toEqual({ status: "shown" });
    expect(await bridge.getCapability()).toEqual({
      platform: "browser",
      supported: true,
      permission: "granted",
      canGuaranteeSilent: true,
      failureMessage: "Browser notification coordination failed: Lock snapshot failed.",
    });
  });

  test("sends one silent notification and publishes its exact click target", async () => {
    const construct = mock((_title: string, _options?: NotificationOptions) => {
      return { onclick: null, onclose: null, onerror: null, onshow: null, close: () => {} };
    });
    const instances: BrowserNotificationInstance[] = [];
    class TestNotification implements BrowserNotificationInstance {
      static permission: NotificationPermission = "granted";
      static requestPermission = async (): Promise<NotificationPermission> => "granted";
      onclick: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onshow: ((event: Event) => void) | null = null;
      silent: boolean | null = null;
      close(): void {}
      constructor(title: string, options?: NotificationOptions) {
        const created = construct(title, options);
        this.onclick = created.onclick;
        this.onclose = created.onclose;
        this.onerror = created.onerror;
        this.onshow = created.onshow;
        instances.push(this);
      }
    }
    const NativeNotification: BrowserNotificationConstructor = TestNotification;
    const focusWindow = mock(() => {});
    const bridge = createBrowserNotificationBridge({
      NativeNotification,
      coordinator: createCoordinator(),
      canGuaranteeSilent: true,
      focusWindow,
    });
    const clicks: NotificationClickEvent[] = [];
    bridge.subscribeClicks((event: NotificationClickEvent) => clicks.push(event));
    const request = {
      occurrenceId: occurrence.occurrenceId,
      title: "Task Closed - task-1",
      body: "Repo - Build notifications",
      silent: true as const,
      navigationTarget: occurrence.navigationTarget,
    };

    const delivery = bridge.showOsNotification(request);
    await Promise.resolve();
    const shownNotification = instances[0];
    if (!shownNotification) throw new Error("The browser notification was not constructed.");
    shownNotification.onshow?.(new Event("show"));

    await expect(delivery).resolves.toEqual({ status: "shown" });
    expect(construct).toHaveBeenCalledWith(request.title, {
      body: request.body,
      data: request.navigationTarget,
      silent: true,
    });
    shownNotification.onclick?.(new Event("click"));
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual([{ navigationTarget: request.navigationTarget }]);
  });

  test("reports cross-tab coordination as unsupported without weaker delivery", async () => {
    const coordinator = createCoordinator();
    coordinator.supported = false;
    class TestNotification implements BrowserNotificationInstance {
      static permission: NotificationPermission = "granted";
      static requestPermission = async (): Promise<NotificationPermission> => "granted";
      onclick: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onshow: ((event: Event) => void) | null = null;
      silent: boolean | null = null;
      close(): void {}
      constructor(_title: string, _options?: NotificationOptions) {}
    }
    const NativeNotification: BrowserNotificationConstructor = TestNotification;
    const bridge = createBrowserNotificationBridge({
      NativeNotification,
      coordinator,
      canGuaranteeSilent: false,
      focusWindow: () => {},
    });

    expect(await bridge.getCapability()).toEqual({
      platform: "browser",
      supported: false,
      permission: "granted",
      canGuaranteeSilent: false,
      failureMessage: "This browser cannot coordinate notifications and sound across tabs.",
    });
  });
});
