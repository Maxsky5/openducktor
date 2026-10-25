import { describe, expect, mock, test } from "bun:test";
import { createRowStateStore } from "./transcript-row-state";

describe("createRowStateStore", () => {
  test("reports the streaming message and the Subagent pending counts", () => {
    const store = createRowStateStore();
    store.set("message-1", { "session-a": 2 });

    expect(store.isStreaming("message-1")).toBe(true);
    expect(store.isStreaming("message-2")).toBe(false);
    expect(store.subagentPendingCount("session-a")).toBe(2);
    expect(store.subagentPendingCount("session-b")).toBe(0);
  });

  test("notifies only when a value changes", () => {
    const store = createRowStateStore();
    const counts = { "session-a": 1 };
    const listener = mock(() => {});
    store.subscribe(listener);

    store.set("message-1", counts);
    store.set("message-1", counts);
    expect(listener).toHaveBeenCalledTimes(1);

    store.set(null, counts);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.isStreaming("message-1")).toBe(false);
  });
});
