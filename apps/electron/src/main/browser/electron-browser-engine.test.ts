import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Effect, Exit, Scope } from "effect";
import type { BrowserEngineEvent } from "@openducktor/host";
import {
  PAGE_NOTIFICATION_BINDING,
  PAGE_NOTIFICATION_SCRIPT,
} from "./electron-browser-page-notifications";
import {
  cancelableEvent,
  createEngineHarness,
  FakeGuest,
  FakePopupWindow,
  MAIN_WINDOW_ID,
  TAB_ID,
  WORKSPACE_ID,
} from "./electron-browser-engine.test-support";

const createTab = (
  harness: ReturnType<typeof createEngineHarness>,
  url = "http://localhost:3000/",
) => Effect.runPromise(harness.engine.createTab({ tabId: TAB_ID, workspaceId: WORKSPACE_ID, url }));

const eventTypes = (events: BrowserEngineEvent[]) => events.map((event) => event.type);

const surface = (visible: boolean, box = { x: 10, y: 20, width: 800, height: 600 }) =>
  visible ? { visible, bounds: box } : { visible };

describe("Electron browser engine state", () => {
  test("is ready only while an OpenDucktor window has a loaded renderer", () => {
    const harness = createEngineHarness();
    expect(harness.engine.state()).toEqual({
      kind: "ready",
      engine: "electron_webview",
    });
    harness.engine.setMainWindowLoaded(MAIN_WINDOW_ID, false);
    expect(harness.engine.state()).toEqual({ kind: "no_window" });
    harness.engine.setMainWindowLoaded(MAIN_WINDOW_ID, true);
    harness.engine.removeMainWindow(MAIN_WINDOW_ID);
    expect(harness.events).toEqual([
      {
        type: "state_changed",
        state: { kind: "ready", engine: "electron_webview" },
      },
      { type: "state_changed", state: { kind: "no_window" } },
      {
        type: "state_changed",
        state: { kind: "ready", engine: "electron_webview" },
      },
      { type: "state_changed", state: { kind: "no_window" } },
    ]);
  });
});

describe("Electron browser engine pages", () => {
  test("creates a page view, takes over its dialogs, draws it on white, and loads the tab URL", async () => {
    const harness = createEngineHarness();
    harness.events.length = 0;
    await createTab(harness);
    const guest = harness.page();

    expect(eventTypes(harness.events)).toEqual(["tab_attached"]);
    expect(guest.listenerCount("-run-dialog")).toBe(0);
    expect(guest.debugger.attached).toBe(true);
    expect(guest.debugger.methods()).toEqual([
      "Target.getTargetInfo",
      "Page.enable",
      "Runtime.enable",
      "Runtime.addBinding",
      "Page.addScriptToEvaluateOnNewDocument",
      "Emulation.setDefaultBackgroundColorOverride",
    ]);
    expect(
      guest.debugger.sent.find(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument")
        ?.params,
    ).toEqual({ source: PAGE_NOTIFICATION_SCRIPT, runImmediately: true });
    expect(guest.debugger.sent.at(-1)?.params).toEqual({ color: { r: 255, g: 255, b: 255, a: 1 } });
    expect(guest.loaded).toEqual(["about:blank", "http://localhost:3000/"]);
    expect(harness.engine.hasLiveTab(TAB_ID)).toBe(true);
  });

  test("starts the page before it attaches the debugger", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();

    expect(guest.loaded[0]).toBe("about:blank");
    expect(guest.debuggerAttachedAtLoad).toEqual([false, true]);
  });

  test("keeps a page that no panel shows in the keeper", async () => {
    const harness = createEngineHarness();
    await createTab(harness);

    expect(harness.viewPort.views).toHaveLength(1);
    expect(harness.viewPort.kept).toEqual([harness.view()]);
    expect(harness.viewPort.placed).toEqual([]);
  });

  test("shows a page in its window at the box, and hides it again", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const view = harness.view();

    await Effect.runPromise(
      harness.engine.setSurface(
        MAIN_WINDOW_ID,
        TAB_ID,
        surface(true, { x: 10, y: 20, width: 800, height: 600 }),
      ),
    );
    expect(harness.viewPort.placed).toEqual([
      { view, windowId: MAIN_WINDOW_ID, box: { x: 10, y: 20, width: 800, height: 600 } },
    ]);

    await Effect.runPromise(harness.engine.setSurface(MAIN_WINDOW_ID, TAB_ID, surface(false)));
    expect(harness.viewPort.kept.at(-1)).toBe(view);
  });

  test("keeps the pages in the keeper while its window has no renderer", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const view = harness.view();
    await Effect.runPromise(harness.engine.setSurface(MAIN_WINDOW_ID, TAB_ID, surface(true)));
    const kept = harness.viewPort.kept.length;

    harness.engine.setMainWindowLoaded(MAIN_WINDOW_ID, false);

    expect(harness.viewPort.kept).toHaveLength(kept + 1);
    expect(harness.viewPort.kept.at(-1)).toBe(view);
    harness.engine.setMainWindowLoaded(MAIN_WINDOW_ID, true);
    expect(harness.viewPort.kept).toHaveLength(kept + 1);
  });

  test("rounds a fractional box and refuses a shown page without one", async () => {
    const harness = createEngineHarness();
    await createTab(harness);

    await Effect.runPromise(
      harness.engine.setSurface(
        MAIN_WINDOW_ID,
        TAB_ID,
        surface(true, { x: 10.4, y: 20.6, width: 800.4, height: 600.6 }),
      ),
    );
    expect(harness.viewPort.placed.at(-1)?.box).toEqual({
      x: 10,
      y: 21,
      width: 800,
      height: 601,
    });
    const exit = await Effect.runPromiseExit(
      harness.engine.setSurface(MAIN_WINDOW_ID, TAB_ID, { visible: true }),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
      "A shown page needs a box",
    );
  });

  test("refuses a surface from a window that is not an OpenDucktor window", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const exit = await Effect.runPromiseExit(harness.engine.setSurface(2, TAB_ID, surface(false)));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
      "Only an OpenDucktor window",
    );
  });

  test("gives the keyboard focus to a page, and keeps a hidden focus request", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();

    await Effect.runPromise(harness.engine.focusPage(MAIN_WINDOW_ID, TAB_ID));
    expect(guest.focused).toBe(0);

    await Effect.runPromise(harness.engine.setSurface(MAIN_WINDOW_ID, TAB_ID, surface(true)));
    expect(guest.focused).toBe(1);
    await Effect.runPromise(harness.engine.setSurface(MAIN_WINDOW_ID, TAB_ID, surface(false)));
    await Effect.runPromise(harness.engine.setSurface(MAIN_WINDOW_ID, TAB_ID, surface(true)));
    expect(guest.focused).toBe(1);
  });

  test("captures the page as a data URL for a host overlay", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    expect(await Effect.runPromise(harness.engine.capturePage(TAB_ID))).toBe(
      "data:image/jpeg;base64,AAAA",
    );
    const missing = await Effect.runPromiseExit(harness.engine.capturePage("missing"));
    expect(Exit.isFailure(missing) && JSON.stringify(missing.cause)).toContain("tab_not_found");
  });

  test("refuses an empty page snapshot", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    harness.page().debugger.pageScreenshotData = "";

    const exit = await Effect.runPromiseExit(harness.engine.capturePage(TAB_ID));

    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
      "The page snapshot is empty.",
    );
  });

  test("takes a screenshot of a hidden page without showing it", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    harness.viewPort.kept.length = 0;

    await Effect.runPromise(harness.engine.captureScreenshot(TAB_ID, { format: "png" }));

    expect(harness.viewPort.kept).toEqual([]);
  });

  test("ends the tab when its page closes", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    harness.events.length = 0;

    guest.destroy();

    expect(harness.events).toEqual([{ type: "tab_ended", tabId: TAB_ID }]);
    expect(harness.engine.hasLiveTab(TAB_ID)).toBe(false);
  });

  test("closes the page at once and forgets the tab", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    harness.events.length = 0;
    await Effect.runPromise(harness.engine.closeTab(TAB_ID));

    expect(guest.closed).toBe(1);
    expect(harness.viewPort.closed).toEqual([harness.view()]);
    expect(harness.events).toEqual([]);
    const exit = await Effect.runPromiseExit(harness.engine.closeTab(TAB_ID));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("tab_not_found");
  });

  test("ends its pages and closes the keeper when the last OpenDucktor window closes", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    harness.events.length = 0;

    harness.engine.removeMainWindow(MAIN_WINDOW_ID);

    expect(guest.closed).toBe(1);
    expect(harness.viewPort.keeperCloses).toBe(1);
    // The tabs stay saved, so the next start restores them like a service disposal does.
    expect(harness.events).not.toContainEqual({ type: "tab_ended", tabId: TAB_ID });
    expect(harness.engine.hasLiveTab(TAB_ID)).toBe(false);
  });

  test("opens a CDP session on the page and detaches it with its scope", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    const scope = await Effect.runPromise(Scope.make());
    const session = await Effect.runPromise(
      harness.engine.openSession(TAB_ID).pipe(Scope.provide(scope)),
    );
    expect(session.targetId).toBe(`target-${guest.id}`);
    const detached: string[] = [];
    session.onDetached((reason) => detached.push(reason));
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(detached).toHaveLength(1);
    expect(guest.debugger.sent.at(-1)).toEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: session.sessionId },
      sessionId: undefined,
    });
  });

  test("reloads the page itself and never over CDP", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();

    await Effect.runPromise(harness.engine.reloadPage(TAB_ID, false));
    await Effect.runPromise(harness.engine.reloadPage(TAB_ID, true));

    expect(guest.reloads).toEqual([false, true]);
    expect(guest.debugger.sent.some((command) => command.method === "Page.reload")).toBe(false);
  });

  test("captures a screenshot through the page CDP session as a viewport clip", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();

    await Effect.runPromise(harness.engine.captureScreenshot(TAB_ID, { format: "png" }));

    expect(guest.debugger.sent.at(-1)).toEqual({
      method: "Page.captureScreenshot",
      params: {
        format: "png",
        quality: 80,
        clip: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
        captureBeyondViewport: false,
      },
      sessionId: undefined,
    });
  });
});

describe("Electron browser engine page events", () => {
  test("refuses top-level navigation to other schemes", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    const mainFrame = { ...cancelableEvent(), url: "file:///etc/hosts", isMainFrame: true };
    const subFrame = { ...cancelableEvent(), url: "file:///etc/hosts", isMainFrame: false };
    guest.emit("will-frame-navigate", mainFrame);
    guest.emit("will-redirect", subFrame);
    guest.emit("will-redirect", {
      ...cancelableEvent(),
      url: "https://ok.example/",
      isMainFrame: true,
    });

    expect(harness.events.at(-1)).toEqual({
      type: "scheme_refused",
      tabId: TAB_ID,
      scheme: "file",
    });
    expect(eventTypes(harness.events).filter((type) => type === "scheme_refused")).toHaveLength(1);
  });

  test("forwards OpenDucktor shortcuts to the window and leaves other keys to the page", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    await Effect.runPromise(harness.engine.setSurface(MAIN_WINDOW_ID, TAB_ID, surface(true)));
    const guest = harness.page();
    const key = (keyName: string, meta: boolean) => {
      const event = cancelableEvent();
      guest.emit("before-input-event", event, {
        type: "keyDown",
        key: keyName,
        control: false,
        meta,
        shift: false,
        alt: false,
      });
      return event.prevented;
    };
    expect(key("k", true)).toBe(true);
    expect(key("k", false)).toBe(false);
    expect(key("c", true)).toBe(false);
    expect(harness.rendererMessages).toEqual([
      { hostId: MAIN_WINDOW_ID, message: { type: "shortcut", shortcut: "command_palette" } },
    ]);
  });

  test("reloads a focused page on its own reload keys, not the window", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    const key = (modifiers: { meta?: boolean; control?: boolean; shift?: boolean }) => {
      const event = cancelableEvent();
      guest.emit("before-input-event", event, {
        type: "keyDown",
        key: "r",
        control: false,
        meta: false,
        shift: false,
        alt: false,
        ...modifiers,
      });
      return event.prevented;
    };

    expect(key({ meta: true })).toBe(true);
    expect(key({ meta: true, shift: true })).toBe(true);
    expect(key({ control: true })).toBe(false);
    expect(guest.reloads).toEqual([false, true]);
  });

  test("keeps the page on beforeunload until the user leaves once", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    const held = cancelableEvent();
    guest.emit("will-prevent-unload", held);
    expect(held.prevented).toBe(false);
    expect(harness.events.at(-1)).toEqual({ type: "navigation_held", tabId: TAB_ID, url: null });

    await Effect.runPromise(harness.engine.allowNextUnload(TAB_ID));
    const allowed = cancelableEvent();
    guest.emit("will-prevent-unload", allowed);
    const heldAgain = cancelableEvent();
    guest.emit("will-prevent-unload", heldAgain);
    expect([allowed.prevented, heldAgain.prevented]).toEqual([true, false]);
  });

  test("keeps a page unthrottled while any wake hold is open", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const view = harness.view();
    const guest = harness.page();
    const first = await Effect.runPromise(Scope.make());
    const second = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(first)));
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(second)));
    expect(guest.backgroundThrottling).toBe(false);
    await Effect.runPromise(Scope.close(first, Exit.void));
    expect(guest.backgroundThrottling).toBe(false);
    await Effect.runPromise(Scope.close(second, Exit.void));

    expect(guest.backgroundThrottling).toBe(true);
    expect(harness.viewPort.kept.at(-1)).toBe(view);
  });

  test("a hold taken before the tab exists does not end a later hold", async () => {
    const harness = createEngineHarness();
    const early = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(early)));
    await createTab(harness);
    const view = harness.view();
    const late = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(late)));

    await Effect.runPromise(Scope.close(early, Exit.void));
    expect(harness.viewPort.kept.at(-1)).toBe(view);
    expect(harness.page().backgroundThrottling).toBe(false);
    await Effect.runPromise(Scope.close(late, Exit.void));
    expect(harness.page().backgroundThrottling).toBe(true);
  });

  test("reports granted page notifications only", async () => {
    const harness = createEngineHarness();
    await createTab(harness, "https://app.example/");
    const guest = harness.page();
    const notify = () =>
      guest.debugger.emitEvent(
        "Runtime.bindingCalled",
        { name: PAGE_NOTIFICATION_BINDING, payload: '{"title":"Done","body":"Build passed"}' },
        "",
      );
    notify();
    expect(eventTypes(harness.events)).not.toContain("page_notification");

    const granted = new Promise<boolean>((resolve) =>
      harness.workspaceSession.requestHandler?.({ id: guest.id }, "notifications", resolve, {
        requestingUrl: "https://app.example/",
        isMainFrame: true,
      }),
    );
    const request = harness.events.at(-1);
    if (request?.type !== "permission_requested") throw new Error("Expected a permission request.");
    expect(request).toMatchObject({
      tabId: TAB_ID,
      origin: "https://app.example",
      permission: "notifications",
    });
    request.respond(true);
    expect(await granted).toBe(true);

    notify();
    expect(harness.events.at(-1)).toEqual({
      type: "page_notification",
      tabId: TAB_ID,
      origin: "https://app.example",
      title: "Done",
      body: "Build passed",
    });
  });

  test("ends a permission request with the document that asked", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    const ask = (isMainFrame: boolean) => {
      let ended = false;
      const granted = new Promise<boolean>((resolve) =>
        harness.workspaceSession.requestHandler?.({ id: guest.id }, "geolocation", resolve, {
          requestingUrl: "https://maps.example/",
          isMainFrame,
        }),
      );
      const request = harness.events.at(-1);
      if (request?.type !== "permission_requested") throw new Error("Expected a request.");
      request.onEnded(() => {
        ended = true;
      });
      return { request, granted, ended: () => ended };
    };
    const frameNavigate = (isMainFrame: boolean) =>
      guest.emit(
        "did-frame-navigate",
        {},
        "https://maps.example/next",
        200,
        "OK",
        isMainFrame,
        1,
        2,
      );

    const frame = ask(false);
    const page = ask(true);
    frameNavigate(false);
    expect(await frame.granted).toBe(false);
    expect([frame.ended(), page.ended()]).toEqual([true, false]);

    frameNavigate(true);
    page.request.respond(true);
    expect(await page.granted).toBe(false);
    expect(page.ended()).toBe(true);
  });

  test("ends the permission request of a frame that goes away without a navigation", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    const granted = new Promise<boolean>((resolve) =>
      harness.workspaceSession.requestHandler?.({ id: guest.id }, "geolocation", resolve, {
        requestingUrl: "https://frame.example/",
        isMainFrame: false,
      }),
    );
    const request = harness.events.at(-1);
    if (request?.type !== "permission_requested") throw new Error("Expected a request.");
    let ended = false;
    request.onEnded(() => {
      ended = true;
    });

    guest.debugger.emitEvent("Page.frameDetached", { frameId: "F2", reason: "remove" }, "");
    request.respond(true);

    expect(await granted).toBe(false);
    expect(ended).toBe(true);
  });

  test("passes page and subresource certificate errors to the host", async () => {
    const harness = createEngineHarness();
    await createTab(harness, "https://self-signed.example/");
    const guest = harness.page();
    const answers: boolean[] = [];
    const callback = (trusted: boolean) => answers.push(trusted);
    const certificateError = (webContentsId: number, url: string, isMainFrame: boolean) =>
      harness.engine.handleCertificateError({
        webContentsId,
        url,
        error: "net::ERR_CERT_AUTHORITY_INVALID",
        isMainFrame,
        callback,
      });

    expect(certificateError(guest.id, "https://cdn.self-signed.example/a.js", false)).toBe(true);
    expect(certificateError(guest.id, "https://self-signed.example/", true)).toBe(true);
    const [subresource, page] = harness.events.filter(
      (event) => event.type === "certificate_error",
    );
    if (subresource?.type !== "certificate_error" || page?.type !== "certificate_error") {
      throw new Error("Expected two certificate errors.");
    }
    subresource.respond(false);
    page.respond(true);

    expect(subresource).toMatchObject({ host: "cdn.self-signed.example", mainFrame: false });
    expect(page).toMatchObject({ host: "self-signed.example", mainFrame: true });
    expect(answers).toEqual([false, true]);
    expect(
      harness.engine.handleCertificateError({
        webContentsId: 999,
        url: "https://x.example/",
        error: "x",
        isMainFrame: true,
        callback,
      }),
    ).toBe(false);
  });

  test("saves downloads and shows them in the folder", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.page();
    const item = {
      getFilename: () => "report.pdf",
      getURL: () => "http://localhost:3000/report.pdf",
      getReceivedBytes: () => 10,
      getTotalBytes: () => 10,
      setSavePath: () => {},
      on: () => {},
      once: () => {},
    };
    harness.workspaceSession.emit("will-download", cancelableEvent(), item, { id: guest.id });
    const update = harness.events.at(-1);
    if (update?.type !== "download_updated") throw new Error("Expected a download update.");
    await Effect.runPromise(
      harness.engine.windows?.revealDownload(TAB_ID, update.download.downloadId) ?? Effect.void,
    );
    expect(harness.revealed).toEqual([path.join("/downloads", "report.pdf")]);
  });

  test("clears the browser data of a removed workspace", async () => {
    const harness = createEngineHarness();
    await Effect.runPromise(harness.engine.deleteWorkspaceProfile(WORKSPACE_ID));
    expect(harness.workspaceSession.cleared).toEqual(["data", "storage", "cache"]);
  });
});

describe("Electron browser engine popups", () => {
  test("opens a window-feature popup without focus and keeps its opener", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = harness.page();
    expect(
      opener.windowOpenHandler?.({ url: "https://auth.example/login", disposition: "new-window" }),
    ).toEqual({
      action: "allow",
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        show: false,
        webPreferences: { focusOnNavigation: false },
      },
    });

    const popupGuest = new FakeGuest(300, harness.workspaceSession);
    const window = new FakePopupWindow(popupGuest);
    opener.emit("did-create-window", window, { url: "https://auth.example/login" });
    await harness.flush();

    const popupEvents = harness.events.filter(
      (event) => event.type === "popup_opened" || event.type === "tab_attached",
    );
    const popupTabId = popupEvents[1]?.type === "popup_opened" ? popupEvents[1].tabId : "";
    expect(popupEvents.slice(1)).toEqual([
      {
        type: "popup_opened",
        openerTabId: TAB_ID,
        tabId: popupTabId,
        url: "https://auth.example/login",
        surface: "popup_window",
        keepsOpener: true,
      },
      { type: "tab_attached", tabId: popupTabId },
    ]);
    expect(popupGuest.listenerCount("-run-dialog")).toBe(0);
    expect(popupGuest.loaded).toEqual([]);
    let prevented = false;
    popupGuest.emit("will-attach-webview", {
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect([window.shownInactive, window.shown, window.focused]).toEqual([1, 0, 0]);

    await Effect.runPromise(harness.engine.windows?.showPopupWindow(popupTabId) ?? Effect.void);
    expect([window.shown, window.focused]).toEqual([1, 1]);
    await Effect.runPromise(harness.engine.closeTab(popupTabId));
    expect(popupGuest.destroyed).toBe(true);
  });

  test("keeps a popup page unthrottled while a wake hold is open", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = harness.page();
    opener.windowOpenHandler?.({ url: "https://auth.example/login", disposition: "new-window" });
    const popupGuest = new FakeGuest(300, harness.workspaceSession);
    const window = new FakePopupWindow(popupGuest);
    opener.emit("did-create-window", window, { url: "https://auth.example/login" });
    await harness.flush();
    const popup = harness.events.find((event) => event.type === "popup_opened");
    if (popup?.type !== "popup_opened") throw new Error("The popup tab is missing.");
    expect(popupGuest.backgroundThrottling).toBe(true);

    const scope = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(popup.tabId).pipe(Scope.provide(scope)));
    expect(popupGuest.backgroundThrottling).toBe(false);
    await Effect.runPromise(Scope.close(scope, Exit.void));

    expect(popupGuest.backgroundThrottling).toBe(true);
  });

  test("ends a popup window tab whose page closes while it attaches", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = harness.page();
    opener.windowOpenHandler?.({ url: "https://auth.example/login", disposition: "new-window" });
    const popupGuest = new FakeGuest(300, harness.workspaceSession);
    const window = new FakePopupWindow(popupGuest);

    opener.emit("did-create-window", window, { url: "https://auth.example/login" });
    window.destroy();
    await harness.flush();

    const popup = harness.events.find((event) => event.type === "popup_opened");
    if (popup?.type !== "popup_opened") throw new Error("Expected a popup.");
    expect(harness.events).toContainEqual({ type: "tab_ended", tabId: popup.tabId });
    const shown = await Effect.runPromise(
      Effect.flip(harness.engine.windows?.showPopupWindow(popup.tabId) ?? Effect.void),
    );
    expect(shown).toMatchObject({ code: "tab_not_found" });
  });

  test("denies other popups and opens them as panel tabs without an opener", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = harness.page();
    expect(
      opener.windowOpenHandler?.({ url: "https://docs.example/", disposition: "foreground-tab" }),
    ).toEqual({ action: "deny" });
    const popup = harness.events.at(-1);
    if (popup?.type !== "popup_opened") throw new Error("Expected a popup.");
    expect(popup).toMatchObject({
      surface: "panel",
      keepsOpener: false,
      url: "https://docs.example/",
    });

    await harness.flush();
    expect(harness.page().loaded).toEqual(["about:blank", "https://docs.example/"]);
  });

  test("places a panel popup when its surface request comes before its view", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = harness.page();
    const requests: Promise<unknown>[] = [];
    const unsubscribe = harness.engine.subscribe((event) => {
      if (event.type !== "popup_opened" || event.surface !== "panel") return;
      requests.push(
        Effect.runPromise(harness.engine.setSurface(MAIN_WINDOW_ID, event.tabId, surface(true))),
      );
    });

    opener.windowOpenHandler?.({ url: "https://docs.example/", disposition: "foreground-tab" });
    unsubscribe();
    await Promise.all(requests);
    await harness.flush();

    expect(harness.viewPort.placed.at(-1)).toMatchObject({
      windowId: MAIN_WINDOW_ID,
      box: { x: 10, y: 20, width: 800, height: 600 },
    });
  });

  test("refuses popups to other schemes", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = harness.page();
    expect(
      opener.windowOpenHandler?.({ url: "file:///etc/hosts", disposition: "new-window" }),
    ).toEqual({
      action: "deny",
    });
    expect(harness.events.at(-1)).toEqual({
      type: "scheme_refused",
      tabId: TAB_ID,
      scheme: "file",
    });
  });
});
