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
    }),
  );
  return { ...tab, client, sent, reloads, screenshots };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("openCdpProxyClient", () => {
  test("sends agent text input to the page as it comes, with no extra press", async () => {
    const { client, pending } = await openClient("agent");

    client.receive({
      id: 1,
      method: "Input.insertText",
      params: { text: "Ada" },
      sessionId: "S1",
    });
    client.receive({
      id: 2,
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "a", text: "a" },
      sessionId: "S1",
    });

    expect(pending.map(({ method, params }) => [method, params])).toEqual([
      ["Input.insertText", { text: "Ada" }],
      ["Input.dispatchKeyEvent", { type: "keyDown", key: "a", text: "a" }],
    ]);
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
