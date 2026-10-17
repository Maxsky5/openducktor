import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import { watchClientPage } from "./client-page";

const hiddenProperty = Object.getOwnPropertyDescriptor(document, "hidden");
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  if (hiddenProperty) Object.defineProperty(document, "hidden", hiddenProperty);
  else Reflect.deleteProperty(document, "hidden");
});

function setup(remote = true) {
  let state: RemoteConnectionState = { status: "connected", generation: 1 };
  const dispose = mock(async () => {});
  const notifications = { dispose: mock(() => {}) };
  const connection = {
    readState: () => state,
    setActive: mock((active: boolean) => {
      state = { ...state, status: active ? "connected" : "idle" };
    }),
  };
  const hostChanged = mock(() => false);
  const reload = spyOn(window.location, "reload").mockImplementation(() => {});
  const leave = watchClientPage(
    remote
      ? { dispose, notifications, remoteConnection: connection, setActive: connection.setActive }
      : { dispose, notifications },
    hostChanged,
  );
  const hidden = (value: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const transition = (type: "pagehide" | "pageshow") =>
    window.dispatchEvent(Object.assign(new Event(type), { persisted: true }));
  return { dispose, notifications, connection, hostChanged, reload, leave, hidden, transition };
}

test("a cached local client reloads because its transport has no pause and resume interface", async () => {
  const page = setup(false);
  try {
    page.transition("pagehide");
    expect(page.notifications.dispose).toHaveBeenCalledTimes(1);
    page.transition("pageshow");
    await page.leave();
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(page.dispose).toHaveBeenCalledTimes(1);
    expect(page.notifications.dispose).toHaveBeenCalledTimes(1);
  } finally {
    await page.leave();
    page.reload.mockRestore();
  }
});

test("leaving stops notifications while network cleanup is pending", async () => {
  const page = setup();
  const network = Promise.withResolvers<void>();
  page.dispose.mockImplementation(() => network.promise);
  try {
    window.dispatchEvent(new Event("pagehide"));
    expect(page.notifications.dispose).toHaveBeenCalledTimes(1);
    expect(page.dispose).toHaveBeenCalledTimes(1);
  } finally {
    network.resolve();
    await page.leave();
    page.reload.mockRestore();
  }
});

test.each([false, true])(
  "a cached client retains its owners and resumes when visible: %s",
  async (hidden) => {
    const page = setup();
    try {
      page.hidden(true);
      page.hidden(false);
      expect(page.connection.setActive).not.toHaveBeenCalled();
      page.transition("pagehide");
      expect(page.connection.setActive.mock.calls).toEqual([[false]]);
      expect(page.dispose).not.toHaveBeenCalled();
      expect(page.notifications.dispose).not.toHaveBeenCalled();
      page.hidden(hidden);
      page.transition("pageshow");
      if (hidden) {
        expect(page.connection.setActive.mock.calls.some(([active]) => active)).toBe(false);
        page.hidden(false);
      }
      expect(page.connection.setActive.mock.calls.at(-1)).toEqual([true]);
      expect(page.reload).not.toHaveBeenCalled();
      expect(page.notifications.dispose).not.toHaveBeenCalled();
      const activations = page.connection.setActive.mock.calls.length;
      window.dispatchEvent(new Event("pagehide"));
      await page.leave();
      expect(page.dispose).toHaveBeenCalledTimes(1);
      expect(page.notifications.dispose).toHaveBeenCalledTimes(1);
      page.transition("pageshow");
      page.hidden(false);
      expect(page.connection.setActive.mock.calls).toHaveLength(activations);
      expect(page.reload).not.toHaveBeenCalled();
    } finally {
      await page.leave();
      page.reload.mockRestore();
    }
  },
);

test.each(["released", "changed"])(
  "a cached page reloads instead of restoring a %s host",
  async (reason) => {
    const page = setup();
    try {
      page.transition("pagehide");
      if (reason === "released") await page.leave();
      else page.hostChanged.mockReturnValue(true);
      page.transition("pageshow");
      await page.leave();
      page.hidden(true);
      page.hidden(false);
      expect(page.connection.setActive.mock.calls).toEqual([[false]]);
      expect(page.reload).toHaveBeenCalledTimes(1);
      expect(page.dispose).toHaveBeenCalledTimes(1);
      expect(page.notifications.dispose).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event("pagehide"));
      page.transition("pageshow");
      expect(page.reload).toHaveBeenCalledTimes(1);
    } finally {
      await page.leave();
      page.reload.mockRestore();
    }
  },
);
