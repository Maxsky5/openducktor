import { describe, expect, test } from "bun:test";
import { CodexRuntimeEventBuffer, CodexRuntimeEventSubscriptions } from "./codex-runtime-events";

const request = (id: number, threadId: string) => ({
  id,
  method: "item/tool/requestUserInput",
  params: { threadId, turnId: `turn-${id}` },
});
const receivedAt = "2026-07-06T12:00:00.000Z";

describe("CodexRuntimeEventSubscriptions", () => {
  test("removes a failed synchronous subscription so the runtime can retry", async () => {
    let subscribeAttempts = 0;
    const subscriptions = new CodexRuntimeEventSubscriptions(() => {
      subscribeAttempts += 1;
      if (subscribeAttempts === 1) {
        throw new Error("subscribe failed");
      }
      return () => undefined;
    });

    expect(() => subscriptions.ensure("runtime-1", () => undefined)).toThrow("subscribe failed");
    await expect(subscriptions.ensure("runtime-1", () => undefined)).resolves.toBeUndefined();
    expect(subscribeAttempts).toBe(2);
  });
});

describe("CodexRuntimeEventBuffer", () => {
  test("keeps buffered server requests isolated by runtime", () => {
    const buffer = new CodexRuntimeEventBuffer();
    buffer.bufferRuntimeStreamEvent("child-thread", {
      runtimeId: "runtime-1",
      kind: "server_request",
      receivedAt,
      message: request(1, "child-thread"),
    });
    buffer.bufferRuntimeStreamEvent("child-thread", {
      runtimeId: "runtime-2",
      kind: "server_request",
      receivedAt,
      message: request(2, "child-thread"),
    });

    expect(buffer.takeServerRequests("child-thread", "runtime-1")).toEqual([
      { request: request(1, "child-thread"), receivedAt },
    ]);
    expect(buffer.takeServerRequests("child-thread", "runtime-2")).toEqual([
      { request: request(2, "child-thread"), receivedAt },
    ]);
  });

  test("clears buffered server requests for one runtime only", () => {
    const buffer = new CodexRuntimeEventBuffer();
    buffer.bufferRuntimeStreamEvent("child-thread", {
      runtimeId: "runtime-1",
      kind: "server_request",
      receivedAt,
      message: request(1, "child-thread"),
    });
    buffer.bufferRuntimeStreamEvent("child-thread", {
      runtimeId: "runtime-2",
      kind: "server_request",
      receivedAt,
      message: request(2, "child-thread"),
    });

    buffer.clearSession("child-thread", "runtime-1");

    expect(buffer.takeServerRequests("child-thread", "runtime-1")).toEqual([]);
    expect(buffer.takeServerRequests("child-thread", "runtime-2")).toEqual([
      { request: request(2, "child-thread"), receivedAt },
    ]);
  });
});
