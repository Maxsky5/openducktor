import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { BrowserAutomationMessage } from "../../ports/browser-automation-port";
import type { CdpEvent, CdpPayload, CdpSession } from "../../ports/browser-engine-port";
import { type CdpProxyClientInput, openCdpProxyClient } from "./browser-cdp-proxy";
import { tabId } from "./test-support/browser-service-harness";

/** A tab session whose commands wait until the test answers them. */
const fakeTabSession = () => {
  const pending: Array<{ method: string; params: CdpPayload | undefined; answer: () => void }> = [];
  let listener: (event: CdpEvent) => void = () => {};
  const session: CdpSession = {
    sessionId: "S1",
    targetId: "PAGE",
    request: (method, params) =>
      new Promise<CdpPayload>((resolve) => {
        pending.push({ method, params, answer: () => resolve({}) });
      }),
    send: () => Effect.succeed({}),
    subscribe: (next) => {
      listener = next;
      return () => {};
    },
    onDetached: () => () => {},
    ownsSession: () => true,
  };
  return { session, pending, emit: (event: CdpEvent) => listener(event) };
};

const openClient = async (kind: CdpProxyClientInput["kind"]) => {
  const tab = fakeTabSession();
  const sent: BrowserAutomationMessage[] = [];
  const pressing: boolean[] = [];
  const reloads: boolean[] = [];
  const screenshots: CdpPayload[] = [];
  const client = await Effect.runPromise(
    openCdpProxyClient({
      kind,
      tabId: tabId(1),
      engine: {
        openSession: () => Effect.succeed(tab.session),
        reloadPage: (_tabId, ignoreCache) => Effect.sync(() => void reloads.push(ignoreCache)),
        captureScreenshot: (_tabId, params) =>
          Effect.sync(() => {
            screenshots.push(params);
            return { data: "IMAGE" };
          }),
      },
      send: (message) => sent.push(message),
      onEnded: () => {},
      onPressing: (value) => pressing.push(value),
    }),
  );
  return { ...tab, client, sent, pressing, reloads, screenshots };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("openCdpProxyClient", () => {
  test("reports the mouse presses of an agent from the first command to the last reply", async () => {
    const { client, pending, pressing } = await openClient("agent");
    const mouse = (id: number, type: string) =>
      client.receive({
        id,
        method: "Input.dispatchMouseEvent",
        params: { type, x: 1, y: 1 },
        sessionId: "S1",
      });

    mouse(1, "mouseMoved");
    mouse(2, "mousePressed");
    mouse(3, "mouseReleased");
    mouse(4, "mousePressed");
    expect(pressing).toEqual([true]);

    for (const command of pending.splice(0)) command.answer();
    await flush();

    expect(pressing).toEqual([true, false]);
  });

  test("ends the press report when the client closes before the reply", async () => {
    const { client, pressing } = await openClient("agent");
    client.receive({
      id: 1,
      method: "Input.dispatchMouseEvent",
      params: { type: "mousePressed", x: 1, y: 1 },
      sessionId: "S1",
    });

    await Effect.runPromise(client.close());

    expect(pressing).toEqual([true, false]);
  });

  test("activates the page with a buttonless press before agent text input", async () => {
    const { client, pending, pressing } = await openClient("agent");

    client.receive({
      id: 1,
      method: "Input.insertText",
      params: { text: "Ada" },
      sessionId: "S1",
    });
    client.receive({
      id: 2,
      method: "Input.dispatchKeyEvent",
      params: { type: "keyUp", key: "Enter" },
      sessionId: "S1",
    });

    expect(pending.map(({ method, params }) => [method, params])).toEqual([
      [
        "Input.dispatchMouseEvent",
        { type: "mousePressed", x: -1, y: -1, button: "none", clickCount: 0 },
      ],
      [
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", x: -1, y: -1, button: "none", clickCount: 0 },
      ],
      ["Input.insertText", { text: "Ada" }],
      ["Input.dispatchKeyEvent", { type: "keyUp", key: "Enter" }],
    ]);
    expect(pressing).toEqual([true]);

    for (const command of pending.splice(0)) command.answer();
    await flush();

    expect(pressing).toEqual([true, false]);
  });

  test("activates the page before a typing key event of an agent, not of DevTools", async () => {
    const agent = await openClient("agent");
    agent.client.receive({
      id: 1,
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "a", text: "a" },
      sessionId: "S1",
    });
    const devtools = await openClient("devtools");
    devtools.client.receive({
      id: 1,
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "a", text: "a" },
    });

    expect(agent.pending.map(({ method }) => method)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchKeyEvent",
    ]);
    expect(devtools.pending.map(({ method }) => method)).toEqual(["Input.dispatchKeyEvent"]);
  });

  test("does not report the presses of a DevTools client", async () => {
    const { client, pressing } = await openClient("devtools");
    client.receive({
      id: 1,
      method: "Input.dispatchMouseEvent",
      params: { type: "mousePressed", x: 1, y: 1 },
    });

    expect(pressing).toEqual([]);
  });

  test("reloads the page through the engine, because Electron cannot reload a guest over CDP", async () => {
    const { client, pending, sent, reloads } = await openClient("devtools");

    client.receive({ id: 1, method: "Page.reload", params: { ignoreCache: true } });
    client.receive({ id: 2, method: "Page.reload" });
    await flush();

    expect(reloads).toEqual([true, false]);
    expect(pending).toEqual([]);
    expect(sent).toEqual([
      { id: 1, result: {} },
      { id: 2, result: {} },
    ]);
  });

  test("takes page screenshots through the engine and frame screenshots over CDP", async () => {
    const { client, pending, sent, screenshots } = await openClient("agent");
    const clip = { x: 0, y: 40, width: 200, height: 80, scale: 0.5 };

    client.receive({
      id: 1,
      method: "Page.captureScreenshot",
      params: { format: "png", clip },
      sessionId: "S1",
    });
    client.receive({ id: 2, method: "Page.captureScreenshot", params: {}, sessionId: "C1" });
    await flush();

    expect(screenshots).toEqual([{ format: "png", clip }]);
    expect(sent).toEqual([{ id: 1, result: { data: "IMAGE" }, sessionId: "S1" }]);
    expect(pending.map((command) => command.method)).toEqual(["Page.captureScreenshot"]);
  });

  test("refuses a target ID outside the tab and its attached frames", async () => {
    const { client, pending, sent, emit } = await openClient("devtools");
    const targetInfo = (id: number, targetId: string) =>
      client.receive({ id, method: "Target.getTargetInfo", params: { targetId } });

    targetInfo(1, "OTHER-TAB");
    targetInfo(2, "PAGE");
    targetInfo(3, "FRAME-1");
    emit({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "C1",
        targetInfo: { targetId: "FRAME-1", type: "iframe" },
        waitingForDebugger: false,
      },
      sessionId: "S1",
    });
    targetInfo(4, "FRAME-1");
    emit({
      method: "Target.detachedFromTarget",
      params: { sessionId: "C1", targetId: "FRAME-1" },
      sessionId: "S1",
    });
    targetInfo(5, "FRAME-1");
    client.receive({ id: 6, method: "Target.getTargetInfo" });

    expect(pending.map((command) => command.params?.targetId ?? null)).toEqual([
      "PAGE",
      "FRAME-1",
      null,
    ]);
    const refused = sent.flatMap((message) => ("error" in message ? [message.id] : []));
    expect(refused).toEqual([1, 3, 5]);
  });
});
