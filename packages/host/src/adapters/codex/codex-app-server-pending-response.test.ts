import { Effect } from "effect";
import { acquirePendingResponse } from "./codex-app-server-pending-response";
import type { PendingCodexAppServerRequest } from "./codex-app-server-transport-types";

describe("acquirePendingResponse", () => {
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
        rememberCancelledSentRequest() {},
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
