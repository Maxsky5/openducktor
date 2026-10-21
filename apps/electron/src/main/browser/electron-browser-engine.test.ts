import { describe, expect, test } from "bun:test";
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
  FakePartitionSession,
  FakePopupWindow,
  MAIN_WINDOW_ID,
  TAB_ID,
  WORKSPACE_ID,
} from "./electron-browser-engine.test-support";

const createTab = (
  harness: ReturnType<typeof createEngineHarness>,
  url = "http://localhost:3000/",
) => Effect.runPromise(harness.engine.createTab({ tabId: TAB_ID, workspaceId: WORKSPACE_ID, url }));

const bindFailure = async (
  harness: ReturnType<typeof createEngineHarness>,
  senderId: number,
  guestId: number,
  tabId = TAB_ID,
) => {
  const exit = await Effect.runPromiseExit(harness.engine.bindGuest(senderId, tabId, guestId));
  if (Exit.isSuccess(exit)) throw new Error("Expected the bind to fail.");
  return JSON.stringify(exit.cause);
};

const eventTypes = (events: BrowserEngineEvent[]) => events.map((event) => event.type);

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

describe("Electron browser engine guests", () => {
  test("binds a guest, takes over its dialogs, draws it on white, and loads the tab URL", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    harness.events.length = 0;
    const guest = await harness.bind();

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
    expect(guest.loaded).toEqual(["http://localhost:3000/"]);
    expect(harness.engine.hasLiveTab(TAB_ID)).toBe(true);
  });

  test("names the Electron change when the internal dialog listener count differs", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.addGuest(100);
    guest.on("-run-dialog", () => {});
    const failure = await bindFailure(harness, MAIN_WINDOW_ID, 100);
    expect(failure).toContain('Electron changed its internal \\"-run-dialog\\" dialog listener');
    expect(guest.loaded).toEqual([]);
  });

  test("refuses guests of other windows, partitions, and senders", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    harness.addGuest(101, { hostId: 2 });
    harness.addGuest(102, { session: new FakePartitionSession() });
    harness.guests.set(103, new FakeGuest(103, harness.workspaceSession, MAIN_WINDOW_ID, "window"));

    expect(await bindFailure(harness, 2, 101)).toContain("Only an OpenDucktor window");
    expect(await bindFailure(harness, MAIN_WINDOW_ID, 101)).toContain("another window");
    expect(await bindFailure(harness, MAIN_WINDOW_ID, 102)).toContain("browser partition");
    expect(await bindFailure(harness, MAIN_WINDOW_ID, 103)).toContain("does not exist");
    expect(await bindFailure(harness, MAIN_WINDOW_ID, 104)).toContain("does not exist");
    expect(await bindFailure(harness, MAIN_WINDOW_ID, 101, "missing")).toContain("tab_not_found");
  });

  test("binds a guest once when the renderer asks twice", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = harness.addGuest(100);
    await Promise.all([
      Effect.runPromise(harness.engine.bindGuest(MAIN_WINDOW_ID, TAB_ID, 100)),
      Effect.runPromise(harness.engine.bindGuest(MAIN_WINDOW_ID, TAB_ID, 100)),
    ]);
    await Effect.runPromise(harness.engine.bindGuest(MAIN_WINDOW_ID, TAB_ID, 100));
    expect(guest.loaded).toHaveLength(1);
    expect(eventTypes(harness.events).filter((type) => type === "tab_attached")).toHaveLength(1);
  });

  test("detaches a destroyed guest and loads its last URL in the next guest", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const first = await harness.bind();
    first.navigate("http://localhost:3000/settings");
    first.destroy();
    expect(harness.events.at(-1)).toEqual({ type: "tab_detached", tabId: TAB_ID });
    expect(harness.engine.hasLiveTab(TAB_ID)).toBe(false);

    const second = await harness.bind(TAB_ID, 200);
    expect(second.loaded).toEqual(["http://localhost:3000/settings"]);
    expect(harness.events.at(-1)).toEqual({ type: "tab_attached", tabId: TAB_ID });
  });

  test("closes the page at once and forgets the tab", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = await harness.bind();
    harness.events.length = 0;
    await Effect.runPromise(harness.engine.closeTab(TAB_ID));

    expect(guest.closed).toBe(1);
    expect(harness.events).toEqual([]);
    const exit = await Effect.runPromiseExit(harness.engine.closeTab(TAB_ID));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("tab_not_found");
  });

  test("opens a CDP session on the page and detaches it with its scope", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = await harness.bind();
    const scope = await Effect.runPromise(Scope.make());
    const session = await Effect.runPromise(
      harness.engine.openSession(TAB_ID).pipe(Scope.provide(scope)),
    );
    expect(session.targetId).toBe("target-100");
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

  test("reloads the guest itself and never over CDP, which reloads the window", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const unbound = await Effect.runPromiseExit(harness.engine.reloadPage(TAB_ID, false));
    const guest = await harness.bind();

    await Effect.runPromise(harness.engine.reloadPage(TAB_ID, false));
    await Effect.runPromise(harness.engine.reloadPage(TAB_ID, true));

    expect(Exit.isFailure(unbound) && JSON.stringify(unbound.cause)).toContain("not_ready");
    expect(guest.reloads).toEqual([false, true]);
    expect(guest.debugger.sent.some((command) => command.method === "Page.reload")).toBe(false);
  });

  test("captures the page through its guest binding", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const unbound = await Effect.runPromiseExit(
      harness.engine.captureScreenshot(TAB_ID, { format: "png" }),
    );
    const guest = await harness.bind();

    await Effect.runPromise(harness.engine.captureScreenshot(TAB_ID, { format: "png" }));

    expect(Exit.isFailure(unbound) && JSON.stringify(unbound.cause)).toContain("not_ready");
    expect(guest.debugger.sent.at(-1)).toEqual({
      method: "Page.captureScreenshot",
      params: { format: "png" },
      sessionId: undefined,
    });
  });

  test("fails to open a session for a tab without a page", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const exit = await Effect.runPromiseExit(Effect.scoped(harness.engine.openSession(TAB_ID)));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("not_ready");
  });
});

describe("Electron browser engine page events", () => {
  test("refuses top-level navigation to other schemes", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = await harness.bind();
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
    const guest = await harness.bind();
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
    const guest = await harness.bind();
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
    const guest = await harness.bind();
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

  test("keeps the page and its window drawn and unthrottled while any wake hold is open", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = await harness.bind();
    const first = await Effect.runPromise(Scope.make());
    const second = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(first)));
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(second)));
    await Effect.runPromise(Scope.close(first, Exit.void));
    expect(guest.throttling).toEqual([false]);
    await Effect.runPromise(Scope.close(second, Exit.void));

    expect(guest.throttling).toEqual([false, true]);
    expect(guest.hostWebContents?.throttling).toEqual([false, true]);
    expect(harness.rendererMessages.map(({ message }) => message)).toEqual([
      { type: "surface_wake", tabId: TAB_ID, awake: true },
      { type: "surface_wake", tabId: TAB_ID, awake: false },
    ]);
  });

  test("a hold taken before the tab exists does not end a later hold", async () => {
    const harness = createEngineHarness();
    const early = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(early)));
    await createTab(harness);
    const guest = await harness.bind();
    const late = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(late)));

    await Effect.runPromise(Scope.close(early, Exit.void));
    expect(guest.throttling).toEqual([false]);
    await Effect.runPromise(Scope.close(late, Exit.void));
    expect(guest.throttling).toEqual([false, true]);
  });

  test("lets the window throttle again when an awake tab closes", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = await harness.bind();
    const host = guest.hostWebContents;
    const scope = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(scope)));

    await Effect.runPromise(harness.engine.closeTab(TAB_ID));

    expect(host?.throttling).toEqual([false, true]);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  test("survives a window reload that destroys an awake guest", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const guest = await harness.bind();
    const host = guest.hostWebContents;
    const scope = await Effect.runPromise(Scope.make());
    await Effect.runPromise(harness.engine.holdWake(TAB_ID).pipe(Scope.provide(scope)));
    harness.events.length = 0;

    // A window reload destroys its guests, and a destroyed guest throws on `hostWebContents`.
    guest.destroy();

    expect(eventTypes(harness.events)).toEqual(["tab_detached"]);
    expect(host?.throttling).toEqual([false, true]);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  test("reports granted page notifications only", async () => {
    const harness = createEngineHarness();
    await createTab(harness, "https://app.example/");
    const guest = await harness.bind();
    const notify = () =>
      guest.debugger.emitEvent(
        "Runtime.bindingCalled",
        { name: PAGE_NOTIFICATION_BINDING, payload: '{"title":"Done","body":"Build passed"}' },
        "",
      );
    notify();
    expect(eventTypes(harness.events)).not.toContain("page_notification");

    const granted = new Promise<boolean>((resolve) =>
      harness.workspaceSession.requestHandler?.({ id: 100 }, "notifications", resolve, {
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
    const guest = await harness.bind();
    const ask = (isMainFrame: boolean) => {
      let ended = false;
      const granted = new Promise<boolean>((resolve) =>
        harness.workspaceSession.requestHandler?.({ id: 100 }, "geolocation", resolve, {
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
    const guest = await harness.bind();
    const granted = new Promise<boolean>((resolve) =>
      harness.workspaceSession.requestHandler?.({ id: 100 }, "geolocation", resolve, {
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
    await harness.bind();
    const answers: boolean[] = [];
    const callback = (trusted: boolean) => answers.push(trusted);
    const certificateError = (url: string, isMainFrame: boolean) =>
      harness.engine.handleCertificateError({
        webContentsId: 100,
        url,
        error: "net::ERR_CERT_AUTHORITY_INVALID",
        isMainFrame,
        callback,
      });

    expect(certificateError("https://cdn.self-signed.example/a.js", false)).toBe(true);
    expect(certificateError("https://self-signed.example/", true)).toBe(true);
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
    await harness.bind();
    const item = {
      getFilename: () => "report.pdf",
      getURL: () => "http://localhost:3000/report.pdf",
      getReceivedBytes: () => 10,
      getTotalBytes: () => 10,
      setSavePath: () => {},
      on: () => {},
      once: () => {},
    };
    harness.workspaceSession.emit("will-download", cancelableEvent(), item, { id: 100 });
    const update = harness.events.at(-1);
    if (update?.type !== "download_updated") throw new Error("Expected a download update.");
    await Effect.runPromise(
      harness.engine.windows?.revealDownload(TAB_ID, update.download.downloadId) ?? Effect.void,
    );
    expect(harness.revealed).toEqual(["/downloads/report.pdf"]);
  });

  test("clears the browser data of a removed workspace", async () => {
    const harness = createEngineHarness();
    await Effect.runPromise(harness.engine.deleteWorkspaceProfile(WORKSPACE_ID));
    expect(harness.workspaceSession.cleared).toEqual(["data", "storage", "cache"]);
  });
});

describe("Electron browser engine popups", () => {
  test("opens a window-feature popup in a popup window that keeps its opener", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = await harness.bind();
    expect(
      opener.windowOpenHandler?.({ url: "https://auth.example/login", disposition: "new-window" }),
    ).toEqual({ action: "allow", outlivesOpener: false });

    const popupGuest = new FakeGuest(300, harness.workspaceSession, null, "window");
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

    await Effect.runPromise(harness.engine.windows?.showPopupWindow(popupTabId) ?? Effect.void);
    expect([window.shown, window.focused]).toEqual([1, 1]);
    await Effect.runPromise(harness.engine.closeTab(popupTabId));
    expect(popupGuest.destroyed).toBe(true);
  });

  test("ends a popup window tab whose page closes while it attaches", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = await harness.bind();
    opener.windowOpenHandler?.({ url: "https://auth.example/login", disposition: "new-window" });
    const popupGuest = new FakeGuest(300, harness.workspaceSession, null, "window");
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
    const opener = await harness.bind();
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

    const guest = await harness.bind(popup.tabId, 400);
    expect(guest.loaded).toEqual(["https://docs.example/"]);
  });

  test("refuses popups to other schemes", async () => {
    const harness = createEngineHarness();
    await createTab(harness);
    const opener = await harness.bind();
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
