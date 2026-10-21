import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { attachCdpTargetSession, type CdpEvent, type CdpPayload } from "@openducktor/host";
import { createElectronDebuggerCdpConnection } from "./electron-debugger-cdp-connection";

type SentCommand = {
  method: string;
  params: CdpPayload | undefined;
  sessionId: string | undefined;
};

class FakeDebugger extends EventEmitter {
  readonly sent: SentCommand[] = [];
  results = new Map<string, CdpPayload>();
  failures = new Map<string, string>();
  attached = false;

  attach(): void {
    this.attached = true;
  }

  isAttached(): boolean {
    return this.attached;
  }

  sendCommand(method: string, params?: CdpPayload, sessionId?: string): Promise<CdpPayload> {
    this.sent.push({ method, params, sessionId });
    const failure = this.failures.get(method);
    if (failure !== undefined) {
      return Promise.reject(new Error(failure));
    }
    return Promise.resolve(this.results.get(method) ?? {});
  }

  emitEvent(method: string, params: CdpPayload, sessionId: string): void {
    this.emit("message", { preventDefault() {} }, method, params, sessionId);
  }
}

describe("createElectronDebuggerCdpConnection", () => {
  test("sends root commands without a session ID and flat commands with one", async () => {
    const debuggerApi = new FakeDebugger();
    debuggerApi.results.set("Runtime.evaluate", { result: { type: "number", value: 2 } });
    const connection = createElectronDebuggerCdpConnection(debuggerApi);

    await connection.request("Page.enable", undefined, "");
    const result = await connection.request("Runtime.evaluate", { expression: "1+1" }, "S1");

    expect(result).toEqual({ result: { type: "number", value: 2 } });
    expect(debuggerApi.sent).toEqual([
      { method: "Page.enable", params: {}, sessionId: undefined },
      { method: "Runtime.evaluate", params: { expression: "1+1" }, sessionId: "S1" },
    ]);
  });

  test("turns a rejected command into a CDP protocol error", async () => {
    const debuggerApi = new FakeDebugger();
    debuggerApi.failures.set("DOM.getDocument", "No node with given id found");
    const connection = createElectronDebuggerCdpConnection(debuggerApi);

    await expect(connection.request("DOM.getDocument", undefined, "S1")).rejects.toMatchObject({
      name: "CdpProtocolError",
      method: "DOM.getDocument",
      message: "No node with given id found",
    });
  });

  test("reports events with their session and stops after the debugger detaches", async () => {
    const debuggerApi = new FakeDebugger();
    const connection = createElectronDebuggerCdpConnection(debuggerApi);
    const events: CdpEvent[] = [];
    const reasons: string[] = [];
    connection.subscribe((event) => events.push(event));
    connection.onClose((reason) => reasons.push(reason));

    debuggerApi.emitEvent("Page.loadEventFired", { timestamp: 1 }, "S1");
    debuggerApi.emit("detach", { preventDefault() {} }, "target closed");
    debuggerApi.emitEvent("Page.loadEventFired", { timestamp: 2 }, "S1");

    expect(events).toEqual([
      { method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "S1" },
    ]);
    expect(reasons).toEqual(["target closed"]);
    expect(connection.isClosed()).toBe(true);
    expect(debuggerApi.listenerCount("message")).toBe(0);
    await expect(connection.request("Page.enable", undefined, "")).rejects.toMatchObject({
      name: "CdpProtocolError",
      message: "CDP connection closed: target closed",
    });
  });

  test("gives each attached target session its own events", async () => {
    const debuggerApi = new FakeDebugger();
    let nextSession = 1;
    debuggerApi.sendCommand = (method, params, sessionId) => {
      debuggerApi.sent.push({ method, params, sessionId });
      return Promise.resolve(
        method === "Target.attachToTarget" ? { sessionId: `S${nextSession++}` } : {},
      );
    };
    const connection = createElectronDebuggerCdpConnection(debuggerApi);
    const first = await attachCdpTargetSession(connection, { targetId: "T", parentSessionId: "" });
    const second = await attachCdpTargetSession(connection, { targetId: "T", parentSessionId: "" });
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    first.subscribe((event) => firstEvents.push(event.method));
    second.subscribe((event) => secondEvents.push(event.method));

    debuggerApi.emitEvent("Runtime.consoleAPICalled", {}, "S1");
    debuggerApi.emitEvent("Page.frameNavigated", {}, "S2");
    await first.close();
    debuggerApi.emitEvent("Page.frameNavigated", {}, "S2");

    expect(firstEvents).toEqual(["Runtime.consoleAPICalled"]);
    expect(secondEvents).toEqual(["Page.frameNavigated", "Page.frameNavigated"]);
    expect(debuggerApi.sent.at(-1)).toEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: "S1" },
      sessionId: undefined,
    });
  });
});
