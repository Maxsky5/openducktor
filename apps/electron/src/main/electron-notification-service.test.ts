import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Event as ElectronEvent, NotificationCloseEventParams } from "electron";
import { ELECTRON_NOTIFICATION_CLICKED_CHANNEL } from "../shared/electron-bridge-contract";
import { createElectronNotificationService } from "./electron-notification-service";

/** An Electron event with the fields that the service reads. */
const electronEvent = <Params extends object>(params: Params): ElectronEvent<Params> => ({
  preventDefault: () => {},
  defaultPrevented: false,
  ...params,
});

class FakeNativeNotification {
  static supported = true;
  static instances: FakeNativeNotification[] = [];
  readonly close = mock(() => {});
  private readonly shown = new Set<() => void>();
  private readonly clicked = new Set<() => void>();
  private readonly closed = new Set<(event: ElectronEvent<NotificationCloseEventParams>) => void>();
  private readonly failed = new Set<(event: ElectronEvent, error: string) => void>();

  static isSupported(): boolean {
    return this.supported;
  }

  constructor(readonly options: { title: string; body: string; silent: boolean }) {
    FakeNativeNotification.instances.push(this);
  }

  on(event: "show" | "click", listener: () => void): void;
  on(event: "close", listener: (event: ElectronEvent<NotificationCloseEventParams>) => void): void;
  on(event: "failed", listener: (event: ElectronEvent, error: string) => void): void;
  on(
    event: "show" | "click" | "close" | "failed",
    listener:
      | (() => void)
      | ((event: ElectronEvent<NotificationCloseEventParams>) => void)
      | ((event: ElectronEvent, error: string) => void),
  ): void {
    if (event === "show" || event === "click") {
      // SAFETY: the overloads accept only a listener without parameters for these events.
      const handler = listener as () => void;
      (event === "show" ? this.shown : this.clicked).add(handler);
    } else if (event === "close") {
      // SAFETY: the overloads accept only a close-event listener for "close".
      this.closed.add(listener as (event: ElectronEvent<NotificationCloseEventParams>) => void);
    } else {
      // SAFETY: the overloads accept only a failure listener for "failed".
      this.failed.add(listener as (event: ElectronEvent, error: string) => void);
    }
  }

  show(): void {}

  emit(event: "show" | "click"): void {
    for (const listener of event === "show" ? this.shown : this.clicked) listener();
  }

  emitClose(params: NotificationCloseEventParams = {}): void {
    for (const listener of this.closed) listener(electronEvent(params));
  }

  emitFailed(error: string): void {
    for (const listener of this.failed) listener(electronEvent({}), error);
  }
}

test("retains Windows Action Center notifications after popup timeout", async () => {
  FakeNativeNotification.instances = [];
  FakeNativeNotification.supported = true;
  const service = createElectronNotificationService({
    Notification: FakeNativeNotification,
    getPermission: () => "not_applicable",
    getWindows: () => [],
    platform: "win32",
  });
  const delivered = service.show(request);
  const native = FakeNativeNotification.instances[0]!;
  native.emit("show");
  native.emitClose({ reason: "timedOut" });
  expect(await delivered).toEqual({ status: "shown" });
  service.dispose();
  expect(native.close).toHaveBeenCalledTimes(1);
});

test.each(["win32", "darwin", "linux"] as const)(
  "reports settings availability separately on %s",
  (platform) => {
    const service = createElectronNotificationService({
      Notification: FakeNativeNotification,
      getPermission: () => "not_applicable",
      getWindows: () => [],
      platform,
    });
    expect(service.getCapability().canOpenSystemSettings).toBe(platform !== "linux");
  },
);

const request = {
  occurrenceId: "workflow.closed:/repo:task-1:event-1",
  title: "Task Closed - task-1",
  body: "Repo - Build notifications",
  silent: true as const,
  navigationTarget: { type: "kanban_task" as const, repoPath: "/repo", taskId: "task-1" },
};

describe("Electron notification service", () => {
  test.each([
    ["denied", undefined],
    ["denied", "notification"],
    ["denied", "test"],
    ["prompt", undefined],
    ["prompt", "notification"],
  ] as const)(
    "blocks %s permission for purpose %s before native construction",
    async (permission, purpose) => {
      FakeNativeNotification.supported = true;
      FakeNativeNotification.instances = [];
      const service = createElectronNotificationService({
        Notification: FakeNativeNotification,
        getPermission: () => permission,
        getWindows: () => [],
      });
      const result = await service.show({ ...request, purpose });
      expect(result).toEqual({
        status: "denied",
        permission,
        message:
          permission === "prompt"
            ? "OS notification permission is required."
            : "OS notification permission was denied. Enable notifications in system settings.",
      });
      expect(FakeNativeNotification.instances).toHaveLength(0);
      service.dispose();
    },
  );

  test.each(["granted", "not_applicable"] as const)(
    "allows normal and test delivery with %s permission",
    async (permission) => {
      FakeNativeNotification.supported = true;
      FakeNativeNotification.instances = [];
      const service = createElectronNotificationService({
        Notification: FakeNativeNotification,
        getPermission: () => permission,
        getWindows: () => [],
      });
      try {
        for (const purpose of [undefined, "notification", "test"] as const) {
          const pending = service.show({ ...request, purpose });
          FakeNativeNotification.instances.at(-1)?.emit("show");
          expect(await pending).toEqual({ status: "shown" });
        }
        expect(FakeNativeNotification.instances).toHaveLength(3);
      } finally {
        service.dispose();
      }
    },
  );

  test("keeps a pending permission test separate from normal delivery", async () => {
    FakeNativeNotification.supported = true;
    FakeNativeNotification.instances = [];
    let permission: "prompt" | "granted" = "prompt";
    const service = createElectronNotificationService({
      Notification: FakeNativeNotification,
      getPermission: () => permission,
      getWindows: () => [],
    });
    try {
      const pendingTest = service.show({ ...request, purpose: "test" });
      expect(await service.show(request)).toMatchObject({ status: "denied" });
      expect(FakeNativeNotification.instances).toHaveLength(1);
      FakeNativeNotification.instances[0]?.emit("show");
      expect(await pendingTest).toEqual({ status: "shown" });
      expect(await service.show(request)).toMatchObject({ status: "denied" });

      permission = "granted";
      const normal = service.show(request);
      FakeNativeNotification.instances[1]?.emit("show");
      expect(await normal).toEqual({ status: "shown" });
    } finally {
      service.dispose();
    }
  });

  test("reports native support and uses silent delivery", async () => {
    FakeNativeNotification.supported = true;
    FakeNativeNotification.instances = [];
    const service = createElectronNotificationService({
      platform: "darwin",
      Notification: FakeNativeNotification,
      getPermission: () => "granted",
      getWindows: () => [],
    });

    expect(service.getCapability()).toEqual({
      platform: "electron",
      supported: true,
      permission: "granted",
      canGuaranteeSilent: true,
      canOpenSystemSettings: true,
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
    FakeNativeNotification.instances[0]?.emitFailed("native failure");
    await expect(delivery).resolves.toEqual({ status: "failed", message: "native failure" });
    expect(service.getCapability()).toMatchObject({ failureMessage: "native failure" });
  });

  test.each([false, true])(
    "routes a notification only to its host, host changed=%s",
    async (changed) => {
      FakeNativeNotification.supported = true;
      FakeNativeNotification.instances = [];
      const restore = mock(() => {});
      const show = mock(() => {});
      const focus = mock(() => {});
      const send = mock(() => {});
      let url = "file:///app/index.html#/kanban";
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
            webContents: { isDestroyed: () => false, getURL: () => url, send },
          },
        ],
      });

      const delivery = service.show(request);
      const native = FakeNativeNotification.instances[0];
      native?.emit("show");
      await delivery;
      if (changed) service.dispose();
      else url = "file:///app/index.html#/sessions";
      native?.emitClose({ reason: "timedOut" });
      native?.emit("click");

      if (changed) {
        expect(send).not.toHaveBeenCalled();
        expect(focus).not.toHaveBeenCalled();
        return;
      }
      expect(restore).toHaveBeenCalledTimes(1);
      expect(show).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(ELECTRON_NOTIFICATION_CLICKED_CHANNEL, {
        navigationTarget: request.navigationTarget,
      });
    },
  );

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
  let expire: () => void = () => {
    throw new Error("Expected a confirmation deadline");
  };
  const originalSetTimeout = globalThis.setTimeout;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(
    // SAFETY: the replacement keeps the call shape and the return value of the real setTimeout.
    ((callback: () => void, delay?: number) => {
      if (delay === 10_000) expire = callback;
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout,
  );
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
  if (ending === "close") FakeNativeNotification.instances[0]?.emitClose();
  else service.dispose();
  await expect(pending).resolves.toMatchObject({ status: "failed" });
  service.dispose();
});
