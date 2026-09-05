import { describe, expect, mock, spyOn, test } from "bun:test";
import { ELECTRON_NOTIFICATION_CLICKED_CHANNEL } from "../shared/electron-bridge-contract";
import { createElectronNotificationService } from "./electron-notification-service";

type Listener = (...args: unknown[]) => void;

class FakeNativeNotification {
  static supported = true;
  static instances: FakeNativeNotification[] = [];
  readonly listeners = new Map<string, Listener>();
  readonly close = mock(() => {});

  static isSupported(): boolean {
    return this.supported;
  }

  constructor(readonly options: { title: string; body: string; silent: boolean }) {
    FakeNativeNotification.instances.push(this);
  }

  on(event: string, listener: Listener): this {
    this.listeners.set(event, listener);
    return this;
  }

  show(): void {}

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.(...args);
  }
}

const request = {
  occurrenceId: "workflow.closed:/repo:task-1:event-1",
  title: "Task Closed - task-1",
  body: "Repo - Build notifications",
  silent: true as const,
  navigationTarget: { type: "kanban_task" as const, repoPath: "/repo", taskId: "task-1" },
};

describe("Electron notification service", () => {
  test("reports native support and uses silent delivery", async () => {
    FakeNativeNotification.supported = true;
    FakeNativeNotification.instances = [];
    const service = createElectronNotificationService({
      Notification: FakeNativeNotification,
      getPermission: () => "granted",
      getWindows: () => [],
    });

    expect(service.getCapability()).toEqual({
      platform: "electron",
      supported: true,
      permission: "granted",
      canGuaranteeSilent: true,
    });
    const delivery = service.show(request);
    const native = FakeNativeNotification.instances[0];
    expect(native?.options).toEqual({
      title: request.title,
      body: request.body,
      silent: true,
    });
    native?.emit("show");
    await expect(delivery).resolves.toEqual({ status: "shown" });
  });

  test("reports unsupported and failed delivery", async () => {
    FakeNativeNotification.supported = false;
    const unsupported = createElectronNotificationService({
      Notification: FakeNativeNotification,
      getPermission: () => "not_applicable",
      getWindows: () => [],
    });
    expect(await unsupported.show(request)).toEqual({
      status: "unsupported",
      message: "This system does not support Electron OS notifications.",
    });

    FakeNativeNotification.supported = true;
    FakeNativeNotification.instances = [];
    const service = createElectronNotificationService({
      Notification: FakeNativeNotification,
      getPermission: () => "granted",
      getWindows: () => [],
    });
    const delivery = service.show(request);
    FakeNativeNotification.instances[0]?.emit("failed", {}, "native failure");
    await expect(delivery).resolves.toEqual({ status: "failed", message: "native failure" });
    expect(service.getCapability()).toMatchObject({ failureMessage: "native failure" });
  });

  test("restores, shows, focuses, and routes the exact target on click", async () => {
    FakeNativeNotification.supported = true;
    FakeNativeNotification.instances = [];
    const restore = mock(() => {});
    const show = mock(() => {});
    const focus = mock(() => {});
    const send = mock(() => {});
    const service = createElectronNotificationService({
      Notification: FakeNativeNotification,
      getPermission: () => "granted",
      getWindows: () => [
        {
          isDestroyed: () => false,
          isMinimized: () => true,
          isVisible: () => false,
          isFocused: () => false,
          restore,
          show,
          focus,
          webContents: { isDestroyed: () => false, send },
        },
      ],
    });

    const delivery = service.show(request);
    const native = FakeNativeNotification.instances[0];
    native?.emit("show");
    await delivery;
    native?.emit("click");

    expect(restore).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ELECTRON_NOTIFICATION_CLICKED_CHANNEL, {
      navigationTarget: request.navigationTarget,
    });
  });

  test("reports denied native notification permission", () => {
    const service = createElectronNotificationService({
      Notification: FakeNativeNotification,
      getPermission: () => "denied",
      getWindows: () => [],
    });

    expect(service.getCapability()).toMatchObject({
      platform: "electron",
      supported: true,
      permission: "denied",
    });
  });
});

test("settles missing native confirmation and clears the failure after recovery", async () => {
  FakeNativeNotification.supported = true;
  FakeNativeNotification.instances = [];
  let expire = () => {
    throw new Error("Expected a confirmation deadline");
  };
  const originalSetTimeout = globalThis.setTimeout;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    if (delay === 10_000) expire = () => callback(...args);
    return originalSetTimeout(callback, delay, ...args);
  });
  const service = createElectronNotificationService({
    Notification: FakeNativeNotification,
    getPermission: () => "granted",
    getWindows: () => [],
  });
  try {
    const pending = service.show(request);
    expire();
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      message: expect.stringContaining("10 seconds"),
    });
    expect(FakeNativeNotification.instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(service.getCapability().failureMessage).toContain("test again");
    const recovery = service.show(request);
    FakeNativeNotification.instances[1]?.emit("show");
    await expect(recovery).resolves.toEqual({ status: "shown" });
    expect(service.getCapability().failureMessage).toBeUndefined();
  } finally {
    service.dispose();
    timer.mockRestore();
  }
});

test.each(["close", "dispose"])("settles an unconfirmed notification on %s", async (ending) => {
  FakeNativeNotification.supported = true;
  FakeNativeNotification.instances = [];
  const service = createElectronNotificationService({
    Notification: FakeNativeNotification,
    getPermission: () => "granted",
    getWindows: () => [],
  });
  const pending = service.show(request);
  if (ending === "close") FakeNativeNotification.instances[0]?.emit("close");
  else service.dispose();
  await expect(pending).resolves.toMatchObject({ status: "failed" });
  service.dispose();
});
