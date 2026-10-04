import { describe, expect, test } from "bun:test";
import type { RuntimeLifecycleImpact } from "@openducktor/contracts";
import { startHostRuntimeEventsHarness } from "@/test-utils/host-runtime-events-harness";
import { createHostRuntimeStatusFixture } from "@/test-utils/shared-test-fixtures";
import { type RuntimeImpactState, watchRuntimeImpact } from "./runtime-impact-watch";

const impact = (confirmation: string): RuntimeLifecycleImpact => ({
  kinds: [],
  workspaces: [],
  confirmation,
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Opens a review on a started host runtime status owner. */
const createHarness = (options: Parameters<typeof startHostRuntimeEventsHarness>[0] = {}) => {
  const { owner, emit } = startHostRuntimeEventsHarness(options);
  const reads: Array<PromiseWithResolvers<RuntimeLifecycleImpact>> = [];
  const states: RuntimeImpactState[] = [];
  const open = () =>
    watchRuntimeImpact({
      kinds: () => ["opencode"],
      readImpact: () => {
        const read = Promise.withResolvers<RuntimeLifecycleImpact>();
        reads.push(read);
        return read.promise;
      },
      events: owner,
      onState: (state) => states.push(state),
    });
  const latest = () => states.at(-1);
  const resolveRead = async (index: number, value: RuntimeLifecycleImpact) => {
    const read = reads[index];
    if (!read) throw new Error(`Read ${index} did not start.`);
    read.resolve(value);
    await settle();
  };
  return { owner, emit, open, latest, reads, resolveRead };
};

const streamWarning = {
  __openducktorBrowserLive: true,
  kind: "stream-warning",
  message: "Event stream lost",
} as const;
const reconnected = {
  __openducktorBrowserLive: true,
  kind: "reconnected",
  transportEpoch: "e:1",
} as const;

describe("watchRuntimeImpact", () => {
  test("a read that completes after a stream failure keeps the failure", async () => {
    const harness = createHarness();
    const watch = harness.open();
    expect(harness.reads).toHaveLength(1);

    harness.emit(streamWarning);
    await harness.resolveRead(0, impact("token-1"));

    expect(harness.latest()).toEqual({
      impact: impact("token-1"),
      isLoading: false,
      error: "Event stream lost",
    });
    watch.close();
    harness.owner.stop();
  });

  test("only a read after the reconnect restores the current state", async () => {
    const harness = createHarness();
    const watch = harness.open();
    await harness.resolveRead(0, impact("token-1"));
    harness.emit(streamWarning);

    harness.emit(reconnected);
    expect(harness.reads).toHaveLength(2);
    // A new failure during the recovery read keeps the review blocked.
    harness.emit(streamWarning);
    await harness.resolveRead(1, impact("token-2"));
    expect(harness.latest()?.error).toBe("Event stream lost");

    harness.emit(reconnected);
    await harness.resolveRead(2, impact("token-3"));
    expect(harness.latest()).toEqual({
      impact: impact("token-3"),
      isLoading: false,
      error: null,
    });
    watch.close();
    harness.owner.stop();
  });

  test("a reconnect during an older read waits for a read that starts after it", async () => {
    const harness = createHarness();
    const watch = harness.open();
    await harness.resolveRead(0, impact("token-1"));
    harness.emit(streamWarning);
    harness.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] });
    expect(harness.reads).toHaveLength(2);

    harness.emit(reconnected);
    await harness.resolveRead(1, impact("token-old"));
    expect(harness.latest()?.error).toBe("Event stream lost");
    expect(harness.reads).toHaveLength(3);

    await harness.resolveRead(2, impact("token-new"));
    expect(harness.latest()).toEqual({
      impact: impact("token-new"),
      isLoading: false,
      error: null,
    });
    watch.close();
    harness.owner.stop();
  });

  test("reads again after a runtime change of a reviewed kind", async () => {
    const harness = createHarness();
    const watch = harness.open();
    await harness.resolveRead(0, impact("token-1"));

    harness.emit({
      type: "runtime_changed",
      hostInstanceId: "host-1",
      status: createHostRuntimeStatusFixture({ kind: "codex", revision: 2 }),
    });
    expect(harness.reads).toHaveLength(1);
    harness.emit({
      type: "runtime_changed",
      hostInstanceId: "host-1",
      status: createHostRuntimeStatusFixture({ kind: "opencode", revision: 2 }),
    });
    expect(harness.reads).toHaveLength(2);
    await harness.resolveRead(1, impact("token-2"));
    expect(harness.latest()).toEqual({ impact: impact("token-2"), isLoading: false, error: null });
    watch.close();
    harness.owner.stop();
  });

  test("a paused review neither reads nor changes state while the action runs", async () => {
    const harness = createHarness();
    const watch = harness.open();
    await harness.resolveRead(0, impact("token-1"));
    const shownBeforeAction = harness.latest();

    watch.pause();
    for (const [state, revision] of [
      ["restarting", 2],
      ["stopping", 3],
      ["starting", 4],
    ] as const) {
      harness.emit({
        type: "runtime_changed",
        hostInstanceId: "host-1",
        status: createHostRuntimeStatusFixture({ kind: "opencode", state, revision }),
      });
    }
    harness.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] });

    expect(harness.reads).toHaveLength(1);
    expect(harness.latest()).toBe(shownBeforeAction);

    // A failed action resumes the review, which then reads the changed impact once.
    watch.resume();
    expect(harness.reads).toHaveLength(2);
    await harness.resolveRead(1, impact("token-2"));
    expect(harness.latest()).toEqual({ impact: impact("token-2"), isLoading: false, error: null });
    watch.close();
    harness.owner.stop();
  });

  test("a resumed review without changes shows the impact that replaced it", async () => {
    const harness = createHarness();
    const watch = harness.open();
    await harness.resolveRead(0, impact("token-1"));

    watch.pause();
    watch.replace(impact("token-2"));
    watch.resume();

    expect(harness.reads).toHaveLength(1);
    expect(harness.latest()).toEqual({ impact: impact("token-2"), isLoading: false, error: null });
    watch.close();
    harness.owner.stop();
  });

  test("a review that opens during a stream failure stays blocked until recovery", async () => {
    // The transport reports the current connection failure before the subscription is ready.
    const harness = createHarness({ onSubscribe: (listener) => listener(streamWarning) });
    await settle();
    const watch = harness.open();
    await harness.resolveRead(0, impact("token-1"));
    expect(harness.latest()).toEqual({
      impact: impact("token-1"),
      isLoading: false,
      error: "Event stream lost",
    });

    harness.emit(reconnected);
    await harness.resolveRead(1, impact("token-2"));
    expect(harness.latest()).toEqual({ impact: impact("token-2"), isLoading: false, error: null });
    watch.close();
    harness.owner.stop();
  });

  test("a review that opens after a failure and recovery during the subscription is current", async () => {
    const harness = createHarness({
      onSubscribe: (listener) => {
        listener(streamWarning);
        listener(reconnected);
      },
    });
    await settle();
    const watch = harness.open();
    await harness.resolveRead(0, impact("token-1"));

    expect(harness.latest()).toEqual({ impact: impact("token-1"), isLoading: false, error: null });
    watch.close();
    harness.owner.stop();
  });
});
