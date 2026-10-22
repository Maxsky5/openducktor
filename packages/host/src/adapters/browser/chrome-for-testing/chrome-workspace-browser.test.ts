import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { BrowserEngineEvent } from "../../../ports/browser-engine-port";
import { CHROME_PAGE_BINDING, chromePageAnswerExpression } from "./chrome-page-script";
import { startChromeWorkspaceBrowser } from "./chrome-workspace-browser";
import { createFakeChrome, settle } from "./test-support/fake-chrome";

const TAB_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "http://localhost:3000";

const start = async () => {
  const fake = createFakeChrome();
  const events: BrowserEngineEvent[] = [];
  let unexpectedExits = 0;
  const browser = await Effect.runPromise(
    startChromeWorkspaceBrowser({
      workspaceId: "acme",
      chrome: fake.chrome,
      emit: (event) => events.push(event),
      onUnexpectedExit: () => {
        unexpectedExits += 1;
      },
    }),
  );
  return { fake, events, browser, unexpectedExits: () => unexpectedExits };
};

/** Opens one tab on `T1` with the engine session `S1`, at a page of `ORIGIN`. */
const startWithTab = async () => {
  const started = await start();
  await Effect.runPromise(started.browser.createTab(TAB_ID, `${ORIGIN}/`));
  started.fake.emit(
    "Runtime.executionContextCreated",
    { context: { id: 7, name: "", origin: ORIGIN, auxData: { frameId: "T1", isDefault: true } } },
    "S1",
  );
  started.events.length = 0;
  return started;
};

describe("startChromeWorkspaceBrowser", () => {
  test("sets up browser-level auto-attach and denies downloads", async () => {
    const { fake } = await start();
    expect(fake.sent("Target.setAutoAttach")[0]?.params).toEqual({
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "page" }],
    });
    expect(fake.sent("Browser.setDownloadBehavior")[0]?.params).toEqual({ behavior: "deny" });
  });

  test("createTab prepares a blank page in a new window before it loads the URL", async () => {
    const { fake, events, browser } = await start();

    await Effect.runPromise(browser.createTab(TAB_ID, `${ORIGIN}/app`));
    await settle();

    expect(fake.sent("Target.createTarget")[0]?.params).toEqual({
      url: "about:blank",
      newWindow: true,
      width: 1280,
      height: 800,
    });
    const s1 = fake.commands.filter((command) => command.sessionId === "S1").map((c) => c.method);
    expect(s1).toEqual([
      "Page.enable",
      "Runtime.enable",
      "Security.enable",
      "Network.enable",
      "Security.setOverrideCertificateErrors",
      "Runtime.addBinding",
      "Page.addScriptToEvaluateOnNewDocument",
      "Runtime.runIfWaitingForDebugger",
      "Page.navigate",
    ]);
    expect(fake.sent("Page.navigate")[0]?.params).toEqual({ url: `${ORIGIN}/app` });
    expect(events).toEqual([{ type: "tab_attached", tabId: TAB_ID }]);
    expect(browser.liveTabCount()).toBe(1);
  });

  test("restarts the history when the first page has its content, so Back skips the blank start page", async () => {
    const { fake, browser } = await start();
    await Effect.runPromise(browser.createTab(TAB_ID, `${ORIGIN}/app`));
    const frame = (url: string) => ({ frame: { id: "T1", loaderId: "L", url } });

    fake.emit("Page.frameNavigated", frame("about:blank"), "S1");
    fake.emit("Page.domContentEventFired", { timestamp: 1 }, "S1");
    await settle();
    expect(fake.sent("Page.resetNavigationHistory")).toEqual([]);

    fake.emit("Page.frameNavigated", frame(`${ORIGIN}/app`), "S1");
    fake.emit("Page.domContentEventFired", { timestamp: 2 }, "S1");
    fake.emit("Page.frameNavigated", frame(`${ORIGIN}/next`), "S1");
    fake.emit("Page.domContentEventFired", { timestamp: 3 }, "S1");
    await settle();
    expect(fake.sent("Page.resetNavigationHistory").map((c) => c.sessionId)).toEqual(["S1"]);
  });

  test("a page that a tab opens becomes a popup tab that keeps its opener", async () => {
    const { fake, events } = await startWithTab();

    const popup = fake.attachPage({ openerId: "T1", canAccessOpener: true });
    await settle();

    const opened = events[0];
    expect(opened).toMatchObject({
      type: "popup_opened",
      openerTabId: TAB_ID,
      url: "about:blank",
      surface: "panel",
      keepsOpener: true,
    });
    const popupTabId = opened?.type === "popup_opened" ? opened.tabId : "";
    expect(popupTabId).toMatch(/^[0-9a-f-]{36}$/);
    expect(events[1]).toEqual({ type: "tab_attached", tabId: popupTabId });
    expect(
      fake.sent("Runtime.runIfWaitingForDebugger").some((c) => c.sessionId === popup.sessionId),
    ).toBe(true);
  });

  test("a noopener popup opens as a tab without the opener link", async () => {
    const { fake, events } = await startWithTab();

    fake.attachPage({ openerId: "T1", canAccessOpener: false, url: `${ORIGIN}/help` });
    await settle();

    expect(events[0]).toMatchObject({
      type: "popup_opened",
      url: `${ORIGIN}/help`,
      keepsOpener: false,
    });
  });

  test("a popup without an opener tab closes", async () => {
    const { fake, events } = await startWithTab();

    const orphan = fake.attachPage({ openerId: "T99" });
    await settle();

    expect(events).toEqual([]);
    expect(fake.sent("Target.closeTarget")[0]?.params).toEqual({ targetId: orphan.targetId });
  });

  test("closeTab closes the page", async () => {
    const { fake, events, browser } = await startWithTab();
    events.length = 0;

    await Effect.runPromise(browser.closeTab(TAB_ID));
    fake.emit("Target.detachedFromTarget", { sessionId: "S1", targetId: "T1" });

    expect(fake.sent("Target.closeTarget")[0]?.params).toEqual({ targetId: "T1" });
    expect(events).toEqual([]);
    expect(browser.knowsTab(TAB_ID)).toBe(false);
  });

  test("a page that closes by itself reports tab_ended until the host closes it", async () => {
    const { fake, events, browser } = await startWithTab();
    events.length = 0;

    fake.emit("Target.detachedFromTarget", { sessionId: "S1", targetId: "T1" });

    expect(events).toEqual([{ type: "tab_ended", tabId: TAB_ID }]);
    expect(browser.liveTabCount()).toBe(0);
    expect(browser.knowsTab(TAB_ID)).toBe(true);

    await Effect.runPromise(browser.closeTab(TAB_ID));

    expect(fake.sent("Target.closeTarget")).toEqual([]);
    expect(browser.knowsTab(TAB_ID)).toBe(false);
  });

  test("an unexpected Chrome exit ends every tab, so the host removes the tabs that lost their page", async () => {
    const started = await startWithTab();

    started.fake.exit();

    expect(started.events).toEqual([{ type: "tab_ended", tabId: TAB_ID }]);
    expect(started.unexpectedExits()).toBe(1);
  });

  test("stops a main-frame navigation to another scheme and reports the scheme", async () => {
    const { fake, events } = await startWithTab();

    fake.emit("Page.frameStartedNavigating", { frameId: "F2", url: "mailto:a@b.test" }, "S1");
    fake.emit("Page.frameStartedNavigating", { frameId: "T1", url: `${ORIGIN}/next` }, "S1");
    fake.emit("Page.frameStartedNavigating", { frameId: "T1", url: "about:blank" }, "S1");
    fake.emit("Page.frameStartedNavigating", { frameId: "T1", url: "mailto:a@b.test" }, "S1");
    await settle();

    expect(events).toEqual([{ type: "scheme_refused", tabId: TAB_ID, scheme: "mailto" }]);
    expect(fake.sent("Page.stopLoading").map((c) => c.sessionId)).toEqual(["S1"]);
  });

  test("a certificate error waits for one answer", async () => {
    const { fake, events } = await startWithTab();

    fake.emit(
      "Security.certificateError",
      { eventId: 4, errorType: "ERR_CERT_AUTHORITY_INVALID", requestURL: "https://dev.test:8443/" },
      "S1",
    );
    const event = events[0];
    expect(event).toMatchObject({
      type: "certificate_error",
      tabId: TAB_ID,
      url: "https://dev.test:8443/",
      host: "dev.test",
      error: "ERR_CERT_AUTHORITY_INVALID",
    });
    if (event?.type !== "certificate_error") throw new Error("No certificate error.");
    event.respond(true);
    event.respond(false);
    await settle();

    expect(fake.sent("Security.handleCertificateError").map((c) => c.params)).toEqual([
      { eventId: 4, action: "continue" },
    ]);
  });

  test("a permission request saves the answer for the origin, then lets the page call continue", async () => {
    const { fake, events } = await startWithTab();

    fake.emit(
      "Runtime.bindingCalled",
      {
        name: CHROME_PAGE_BINDING,
        payload: JSON.stringify({ type: "permission", requestId: 3, permission: "clipboard_read" }),
        executionContextId: 7,
      },
      "S1",
    );
    const event = events[0];
    expect(event).toMatchObject({
      type: "permission_requested",
      tabId: TAB_ID,
      origin: ORIGIN,
      permission: "clipboard_read",
    });
    if (event?.type !== "permission_requested") throw new Error("No permission request.");
    event.respond(true);
    await settle();

    const setPermission = fake.sent("Browser.setPermission");
    expect(setPermission.map((c) => [c.sessionId, c.params])).toEqual([
      [
        "",
        {
          permission: { name: "clipboard-read" },
          setting: "granted",
          origin: ORIGIN,
          embeddedOrigin: ORIGIN,
        },
      ],
    ]);
    const answer = fake.sent("Runtime.evaluate").at(-1);
    expect(answer).toEqual({
      method: "Runtime.evaluate",
      sessionId: "S1",
      params: { expression: chromePageAnswerExpression(3), contextId: 7 },
    });
  });

  test("a frame of another origin asks for its own origin inside the top-level origin", async () => {
    const { fake, events } = await startWithTab();
    const frameOrigin = "http://localhost:3001";
    fake.emit(
      "Runtime.executionContextCreated",
      {
        context: {
          id: 9,
          name: "",
          origin: frameOrigin,
          auxData: { frameId: "F2", isDefault: true },
        },
      },
      "S1",
    );

    fake.emit(
      "Runtime.bindingCalled",
      {
        name: CHROME_PAGE_BINDING,
        payload: JSON.stringify({ type: "permission", requestId: 2, permission: "camera" }),
        executionContextId: 9,
      },
      "S1",
    );
    const event = events[0];
    expect(event).toMatchObject({ type: "permission_requested", origin: frameOrigin });
    if (event?.type !== "permission_requested") throw new Error("No permission request.");
    event.respond(true);
    await settle();

    expect(fake.sent("Browser.setPermission").map((c) => c.params)).toEqual([
      {
        permission: { name: "camera" },
        setting: "granted",
        origin: ORIGIN,
        embeddedOrigin: frameOrigin,
      },
    ]);
    expect(fake.sent("Runtime.evaluate").at(-1)?.params).toEqual({
      expression: chromePageAnswerExpression(2),
      contextId: 9,
    });
  });

  test("a reset sets the permissions of a site back to prompt and stops its notifications", async () => {
    const { fake, events, browser } = await startWithTab();
    const ask = (requestId: number, permission: string) => {
      fake.emit(
        "Runtime.bindingCalled",
        {
          name: CHROME_PAGE_BINDING,
          payload: JSON.stringify({ type: "permission", requestId, permission }),
          executionContextId: 7,
        },
        "S1",
      );
      const request = events.at(-1);
      if (request?.type !== "permission_requested") throw new Error("No permission request.");
      request.respond(true);
    };
    ask(1, "notifications");
    ask(2, "camera");
    await settle();
    events.length = 0;

    await Effect.runPromise(browser.revokeSitePermissions(ORIGIN, "notifications"));
    fake.emit(
      "Runtime.bindingCalled",
      {
        name: CHROME_PAGE_BINDING,
        payload: JSON.stringify({ type: "notification", title: "Done", body: "" }),
        executionContextId: 7,
      },
      "S1",
    );
    await Effect.runPromise(browser.revokeSitePermissions(ORIGIN, null));
    await Effect.runPromise(browser.revokeSitePermissions(ORIGIN, null));

    expect(events).toEqual([]);
    expect(
      fake
        .sent("Browser.setPermission")
        .slice(2)
        .map((c) => c.params),
    ).toEqual([
      {
        permission: { name: "notifications" },
        setting: "prompt",
        origin: ORIGIN,
        embeddedOrigin: ORIGIN,
      },
      { permission: { name: "camera" }, setting: "prompt", origin: ORIGIN, embeddedOrigin: ORIGIN },
    ]);
  });

  test("a frame request ends with its document, and a late answer grants nothing", async () => {
    const { fake, events } = await startWithTab();
    const frameOrigin = "http://localhost:3001";
    fake.emit(
      "Runtime.executionContextCreated",
      {
        context: {
          id: 2,
          name: "",
          origin: frameOrigin,
          auxData: { frameId: "F2", isDefault: true },
        },
      },
      "S1",
    );
    fake.emit(
      "Runtime.bindingCalled",
      {
        name: CHROME_PAGE_BINDING,
        payload: JSON.stringify({ type: "permission", requestId: 5, permission: "geolocation" }),
        executionContextId: 2,
      },
      "S1",
    );
    const request = events[0];
    if (request?.type !== "permission_requested") throw new Error("No permission request.");
    let endedEarly = false;
    request.onEnded(() => {
      endedEarly = true;
    });

    fake.emit("Runtime.executionContextDestroyed", { executionContextId: 2 }, "S1");
    fake.emit("Page.frameDetached", { frameId: "F2" }, "S1");
    let endedLate = false;
    request.onEnded(() => {
      endedLate = true;
    });
    request.respond(true);
    await settle();

    expect([endedEarly, endedLate]).toEqual([true, true]);
    expect(fake.sent("Browser.setPermission")).toEqual([]);
    expect(
      fake.sent("Runtime.evaluate").filter((command) => command.params?.contextId === 2),
    ).toEqual([]);
  });

  test("a page that clears its contexts or closes ends its waiting requests", async () => {
    const { fake, events } = await startWithTab();
    const ask = (requestId: number, executionContextId = 7) => {
      const before = events.length;
      fake.emit(
        "Runtime.bindingCalled",
        {
          name: CHROME_PAGE_BINDING,
          payload: JSON.stringify({ type: "permission", requestId, permission: "camera" }),
          executionContextId,
        },
        "S1",
      );
      expect(events.length).toBe(before + 1);
      const request = events.at(-1);
      if (request?.type !== "permission_requested") throw new Error("No permission request.");
      let ended = false;
      request.onEnded(() => {
        ended = true;
      });
      return () => ended;
    };

    const cleared = ask(1);
    fake.emit("Runtime.executionContextsCleared", {}, "S1");
    fake.emit(
      "Runtime.executionContextCreated",
      { context: { id: 8, name: "", origin: ORIGIN, auxData: { frameId: "T1", isDefault: true } } },
      "S1",
    );
    const closed = ask(2, 8);
    fake.emit("Target.detachedFromTarget", { sessionId: "S1", targetId: "T1" });

    expect([cleared(), closed()]).toEqual([true, true]);
  });

  test("a reset right after an answer reaches Chrome after the grant", async () => {
    const { fake, events, browser } = await startWithTab();
    fake.emit(
      "Runtime.bindingCalled",
      {
        name: CHROME_PAGE_BINDING,
        payload: JSON.stringify({ type: "permission", requestId: 1, permission: "camera" }),
        executionContextId: 7,
      },
      "S1",
    );
    const request = events[0];
    if (request?.type !== "permission_requested") throw new Error("No permission request.");

    request.respond(true);
    await Effect.runPromise(browser.revokeSitePermissions(ORIGIN, "camera"));

    expect(fake.sent("Browser.setPermission").map((c) => c.params?.setting)).toEqual([
      "granted",
      "prompt",
    ]);
  });

  test("reports page notifications only for origins that the engine granted", async () => {
    const { fake, events } = await startWithTab();
    const notify = () =>
      fake.emit(
        "Runtime.bindingCalled",
        {
          name: CHROME_PAGE_BINDING,
          payload: JSON.stringify({ type: "notification", title: "Done", body: "Build passed" }),
          executionContextId: 7,
        },
        "S1",
      );

    notify();
    expect(events).toEqual([]);

    fake.emit(
      "Runtime.bindingCalled",
      {
        name: CHROME_PAGE_BINDING,
        payload: JSON.stringify({ type: "permission", requestId: 1, permission: "notifications" }),
        executionContextId: 7,
      },
      "S1",
    );
    const request = events[0];
    if (request?.type !== "permission_requested") throw new Error("No permission request.");
    request.respond(true);
    await settle();
    notify();

    expect(events.at(-1)).toEqual({
      type: "page_notification",
      tabId: TAB_ID,
      origin: ORIGIN,
      title: "Done",
      body: "Build passed",
    });
  });

  test("ignores binding payloads that do not match the page script", async () => {
    const { fake, events } = await startWithTab();

    fake.emit(
      "Runtime.bindingCalled",
      { name: CHROME_PAGE_BINDING, payload: "{not json", executionContextId: 7 },
      "S1",
    );
    fake.emit(
      "Runtime.bindingCalled",
      {
        name: CHROME_PAGE_BINDING,
        payload: JSON.stringify({ type: "permission", requestId: 1, permission: "usb" }),
        executionContextId: 7,
      },
      "S1",
    );

    expect(events).toEqual([]);
  });

  test("stop ends Chrome and detaches the live tabs", async () => {
    const { fake, events, browser, unexpectedExits } = await startWithTab();

    await Effect.runPromise(browser.stop());

    expect(fake.isStopped()).toBe(true);
    expect(events).toEqual([{ type: "tab_detached", tabId: TAB_ID }]);
    expect(unexpectedExits()).toBe(0);
  });
});
