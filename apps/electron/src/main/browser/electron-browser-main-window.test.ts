import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { attachBrowserMainWindow } from "./electron-browser-main-window";
import type { WebviewPreferences } from "./electron-browser-policy";
import { cancelableEvent } from "./electron-browser-engine.test-support";

class FakeMainWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { id: 5 });
}

const setup = () => {
  const calls: string[] = [];
  const failures: string[] = [];
  const window = new FakeMainWindow();
  attachBrowserMainWindow(
    {
      addMainWindow: (id) => calls.push(`add:${id}`),
      setMainWindowLoaded: (id, loaded) => calls.push(`loaded:${id}:${loaded}`),
      removeMainWindow: (id) => calls.push(`remove:${id}`),
      prepareWorkspace: (workspaceId) => calls.push(`prepare:${workspaceId}`),
    },
    window,
    (_operation, cause) => failures.push(cause.message),
  );
  const attach = (src: string, partition: string) => {
    const event = cancelableEvent();
    const preferences: WebviewPreferences = { preload: "/evil.js", sandbox: false };
    window.webContents.emit("will-attach-webview", event, preferences, { src, partition });
    return { prevented: event.prevented, preferences };
  };
  return { calls, failures, window, attach };
};

describe("attachBrowserMainWindow", () => {
  test("hardens and allows browser webviews in workspace partitions", () => {
    const { calls, attach } = setup();
    const result = attach("about:blank", "persist:openducktor-browser-repo");
    expect(result.prevented).toBe(false);
    expect(result.preferences.preload).toBeUndefined();
    expect(result.preferences.sandbox).toBe(true);
    expect(calls).toEqual(["add:5", "prepare:repo"]);
  });

  test("prevents webviews in the app partition and reports why", () => {
    const { failures, attach } = setup();
    const result = attach("https://example.com/", "persist:openducktor");
    expect(result.prevented).toBe(true);
    expect(failures).toEqual(['A webview cannot use the partition "persist:openducktor".']);
  });

  test("stops the window at each new document, a renderer loss, and the window close", () => {
    const { calls, window } = setup();
    // A navigation that `will-navigate` refuses starts but never commits.
    window.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    window.webContents.emit("did-navigate");
    window.webContents.emit("render-process-gone");
    window.emit("closed");
    expect(calls).toEqual(["add:5", "loaded:5:false", "loaded:5:false", "remove:5"]);
  });
});
