import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ElectronViewOwner } from "./electron-browser-view-port";
import { attachBrowserMainWindow } from "./electron-browser-main-window";
import type { WebviewPreferences } from "./electron-browser-policy";
import { cancelableEvent } from "./electron-browser-engine.test-support";

type FakeMainWindow = EventEmitter & {
  webContents: EventEmitter & { readonly id: number; isDestroyed(): boolean };
  contentView: ElectronViewOwner["contentView"];
  getContentSize(): number[];
  isDestroyed(): boolean;
};

const DEVTOOLS_URL =
  "devtools://devtools/bundled/devtools_app.html?ws=127.0.0.1:4000/secret/devtools/tab";

const fakeMainWindow = (): FakeMainWindow => {
  // SAFETY: the test fills the view owner fields and the web contents of the window below.
  const window = new EventEmitter() as FakeMainWindow;
  const contents = Object.assign(new EventEmitter(), {
    id: 5,
    isDestroyed: () => false,
  });
  window.webContents = contents;
  window.contentView = {
    addChildView: () => {},
    removeChildView: () => {},
  };
  window.getContentSize = () => [1200, 800];
  window.isDestroyed = () => false;
  return window;
};

const setup = () => {
  const calls: string[] = [];
  const failures: string[] = [];
  const window = fakeMainWindow();
  const viewPort = {
    registerWindow: (windowId: number, owner: ElectronViewOwner) =>
      calls.push(`register:${windowId}:${owner === window}`),
    unregisterWindow: (windowId: number) => calls.push(`unregister:${windowId}`),
  };
  attachBrowserMainWindow(
    {
      addMainWindow: (id) => calls.push(`add:${id}`),
      setMainWindowLoaded: (id, loaded) => calls.push(`loaded:${id}:${loaded}`),
      removeMainWindow: (id) => calls.push(`remove:${id}`),
    },
    viewPort,
    window,
    (_operation, cause) => failures.push(cause.message),
  );
  const attach = (src = DEVTOOLS_URL, partition = "persist:openducktor-devtools") => {
    const event = cancelableEvent();
    const preferences: WebviewPreferences = { preload: "/evil.js", sandbox: false };
    window.webContents.emit("will-attach-webview", event, preferences, { src, partition });
    return { prevented: event.prevented, preferences };
  };
  return { calls, failures, window, attach };
};

describe("attachBrowserMainWindow", () => {
  test("registers the window and lets only the bundled DevTools webview attach, with the sandbox", () => {
    const { calls, attach } = setup();
    const result = attach();
    expect(result.prevented).toBe(false);
    expect(result.preferences.preload).toBeUndefined();
    expect(result.preferences.sandbox).toBe(true);
    expect(calls).toEqual(["add:5", "register:5:true"]);
  });

  test("prevents browser and app webviews, and reports why", () => {
    const { failures, attach } = setup();
    const browser = attach("about:blank", "persist:openducktor-browser-repo");
    const app = attach("https://example.com/", "persist:openducktor");
    const otherDevTools = attach("https://evil.example/", "persist:openducktor-devtools");

    expect([browser.prevented, app.prevented, otherDevTools.prevented]).toEqual([true, true, true]);
    expect(failures).toEqual([
      'A webview cannot use the partition "persist:openducktor-browser-repo".',
      'A webview cannot use the partition "persist:openducktor".',
      "A DevTools webview can load only the bundled DevTools frontend.",
    ]);
  });

  test("stops the window at each new document, a renderer loss, and the window close", () => {
    const { calls, window } = setup();
    window.webContents.emit("did-navigate");
    window.webContents.emit("render-process-gone");
    window.emit("closed");
    expect(calls).toEqual([
      "add:5",
      "register:5:true",
      "loaded:5:false",
      "loaded:5:false",
      "unregister:5",
      "remove:5",
    ]);
  });
});
