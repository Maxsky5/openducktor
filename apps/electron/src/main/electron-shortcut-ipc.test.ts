import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import type { ElectronShortcutRules, EmbeddedShortcutEvent } from "@openducktor/contracts";
import {
  bindShortcutGuest,
  registerElectronShortcutIpc,
  routeGuestShortcut,
} from "./electron-shortcut-ipc";
import {
  ELECTRON_SHORTCUT_APPLY_CHANNEL,
  ELECTRON_SHORTCUT_RELEASE_CHANNEL,
} from "../shared/electron-bridge-contract";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness() {
  const contents = Object.assign(new EventEmitter(), {
    id: 771,
    mainFrame: {},
    isDestroyed: () => false,
    send: (
      _channel: string,
      message: { sourceTabId: string | null; event: EmbeddedShortcutEvent },
    ) => messages.push(message),
    setIgnoreMenuShortcuts: (value: boolean) => {
      ignored = value;
    },
  });
  const window = Object.assign(new EventEmitter(), { id: 22, webContents: contents });
  const messages: { sourceTabId: string | null; event: EmbeddedShortcutEvent }[] = [];
  let ignored = false;
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, rules?: ElectronShortcutRules) => void
  >();
  // SAFETY: This fixture implements the IPC and window methods used by the routing boundary.
  registerElectronShortcutIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) } as Pick<IpcMain, "handle">,
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The Electron fixture supplies only the methods this boundary calls.
    () => window as unknown as BrowserWindow,
  );
  // SAFETY: The IPC owner check uses these exact sender and frame identities.
  const event = {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The sender fixture supplies the methods and identity used by this boundary.
    sender: contents as unknown as WebContents,
    senderFrame: contents.mainFrame,
  } as IpcMainInvokeEvent;
  const apply = (rules: ElectronShortcutRules) =>
    handlers.get(ELECTRON_SHORTCUT_APPLY_CHANNEL)!(event, rules);
  cleanups.push(() => handlers.get(ELECTRON_SHORTCUT_RELEASE_CHANNEL)!(event));
  return { contents, messages, apply, event, handlers, ignored: () => ignored };
}
const combination = {
  key: { kind: "logical" as const, key: "p" },
  ctrl: true,
  meta: false,
  alt: false,
  shift: true,
};
const input = {
  type: "keyDown" as const,
  key: "p",
  code: "KeyP",
  control: true,
  meta: false,
  alt: false,
  shift: true,
};
const rules = (revision = 1): ElectronShortcutRules => ({
  revision,
  recording: false,
  reservePanelCloseModW: false,
  suppressMenuFor: [combination],
  guestRoutes: [{ commandId: "new-task", combination }],
});

describe("window shortcut routing", () => {
  test("suppresses menus without invoking renderer commands and replaces listeners on edits", () => {
    const h = harness();
    for (let revision = 1; revision < 30; revision++) h.apply(rules(revision));
    h.contents.emit("before-input-event", {}, input);
    expect(h.ignored()).toBe(true);
    expect(h.messages).toEqual([]);
    expect(h.contents.listenerCount("before-input-event")).toBe(1);
    expect(h.contents.listenerCount("destroyed")).toBe(1);
    h.contents.emit("before-input-event", {}, { ...input, shift: false });
    expect(h.ignored()).toBe(false);
  });

  test("keeps held app menu chords and the close-window reservation consumed without repeating the action", () => {
    const h = harness();
    h.apply({ ...rules(), reservePanelCloseModW: true });
    h.contents.emit("before-input-event", {}, { ...input, isAutoRepeat: true });
    expect(h.ignored()).toBe(true);
    const close = {
      ...input,
      key: "w",
      code: "KeyW",
      control: process.platform !== "darwin",
      meta: process.platform === "darwin",
      shift: false,
      isAutoRepeat: true,
    };
    h.contents.emit("before-input-event", {}, close);
    expect(h.ignored()).toBe(true);
    const release = bindShortcutGuest(883, () => ({ windowId: h.event.sender.id, tabId: "tab-c" }));
    cleanups.push(release);
    let prevented = 0;
    expect(
      routeGuestShortcut(
        883,
        { preventDefault: () => prevented++ },
        { ...input, isAutoRepeat: true },
      ),
    ).toBe(true);
    expect(routeGuestShortcut(883, { preventDefault: () => prevented++ }, close)).toBe(true);
    expect(prevented).toBe(2);
    expect(h.messages.filter((message) => message.event.type === "invoke")).toHaveLength(0);
  });

  test("ordinary guest typing sends no hint messages and modifier transitions send one each", () => {
    const h = harness();
    h.apply({ ...rules(), guestRoutes: [] });
    cleanups.push(bindShortcutGuest(884, () => ({ windowId: h.event.sender.id, tabId: "typing" })));
    const event = {
      preventDefault() {
        throw new Error("Typing must remain with the page.");
      },
    };
    for (const key of ["a", "b", "c"]) {
      routeGuestShortcut(884, event, { ...input, key, control: false, meta: false, shift: false });
      routeGuestShortcut(884, event, {
        ...input,
        type: "keyUp",
        key,
        control: false,
        meta: false,
        shift: false,
      });
    }
    expect(h.messages).toHaveLength(0);
    const held = {
      ...input,
      control: process.platform !== "darwin",
      meta: process.platform === "darwin",
      shift: false,
    };
    routeGuestShortcut(884, event, held);
    routeGuestShortcut(884, event, { ...held, key: "a" });
    routeGuestShortcut(884, event, { ...held, key: "a", type: "keyUp" });
    expect(h.messages.map((message) => message.event.type)).toEqual(["key-state"]);
    routeGuestShortcut(884, event, { ...held, type: "keyUp", control: false, meta: false });
    expect(h.messages.map((message) => message.event.type)).toEqual(["key-state", "key-state"]);
  });

  test("routes a bound guest once with its renderer identity and current revision, then releases it", () => {
    const h = harness();
    h.apply(rules(7));
    const release = bindShortcutGuest(881, () => ({ windowId: h.event.sender.id, tabId: "tab-a" }));
    cleanups.push(release);
    let prevented = 0;
    expect(routeGuestShortcut(881, { preventDefault: () => prevented++ }, input)).toBe(true);
    expect(prevented).toBe(1);
    expect(h.messages.at(-1)).toMatchObject({
      sourceTabId: "tab-a",
      event: { type: "invoke", revision: 7, commandId: "new-task" },
    });
    h.apply({ ...rules(8), guestRoutes: [] });
    expect(routeGuestShortcut(881, { preventDefault: () => prevented++ }, input)).toBe(false);
    release();
    expect(routeGuestShortcut(881, { preventDefault: () => prevented++ }, input)).toBe(false);
    expect(prevented).toBe(1);
  });

  test("rejects a subframe and gives recording priority over app routes", () => {
    const h = harness();
    expect(() =>
      h.handlers.get(ELECTRON_SHORTCUT_APPLY_CHANNEL)!({ ...h.event, senderFrame: null }, rules()),
    ).toThrow("main renderer frame");
    h.apply({ ...rules(), recording: true });
    const release = bindShortcutGuest(882, () => ({ windowId: h.event.sender.id, tabId: "tab-b" }));
    cleanups.push(release);
    expect(
      routeGuestShortcut(
        882,
        {
          preventDefault: () => {
            throw new Error("Recording claimed a guest command");
          },
        },
        input,
      ),
    ).toBe(false);
    expect(h.messages).not.toContainEqual(
      expect.objectContaining({ event: expect.objectContaining({ type: "invoke" }) }),
    );
  });
});
