import { Effect } from "effect";
import { acquirePendingResponse } from "./codex-app-server-pending-response";
import type { PendingCodexAppServerRequest } from "./codex-app-server-transport-types";

describe("acquirePendingResponse", () => {
  test("does not accept a late response when a request times out before send", async () => {
    let fireTimeout = (): void => {};
    const lateRequestIds: number[] = [];
    const acquired = Effect.runSync(
      acquirePendingResponse({
        id: 1,
        method: "model/list",
        runtimeId: "runtime-1",
        requestTimeoutMs: 1_000,
        pending: new Map(),
        keepLateRequestId: (id) => lateRequestIds.push(id),
        scheduleTimeout: (callback) => {
          fireTimeout = callback;
          return () => {};
        },
      }),
    );
    fireTimeout();
    await expect(Effect.runPromise(acquired.response)).rejects.toThrow("Timed out waiting");
    expect(lateRequestIds).toEqual([]);
    acquired.release({ keepRequestId: true });
    expect(lateRequestIds).toEqual([]);
  });

  test("cancels its timeout when released", () => {
    const pending = new Map<number, PendingCodexAppServerRequest>();
    let cancelCount = 0;

    const acquired = Effect.runSync(
      acquirePendingResponse({
        id: 1,
        method: "model/list",
        runtimeId: "runtime-1",
        requestTimeoutMs: 1_000,
        pending,
        keepLateRequestId() {},
        scheduleTimeout: () => () => {
          cancelCount += 1;
        },
      }),
    );

    expect(pending.has(1)).toBe(true);

    acquired.release();

    expect(cancelCount).toBe(1);
    expect(pending.has(1)).toBe(false);

    acquired.release();
    expect(cancelCount).toBe(1);
  });
});
