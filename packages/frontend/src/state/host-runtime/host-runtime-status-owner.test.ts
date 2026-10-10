import { describe, expect, mock, spyOn, test } from "bun:test";
import type { HostRuntimeSnapshot, HostRuntimeStatus } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { scheduleTask as defaultScheduleTask, type ScheduleTask } from "@/lib/scheduling";
import type { RuntimeChangeListener } from "@/lib/shell-bridge";
import type { HostStatusSnapshot } from "@/types/diagnostics";
import { hostRuntimeStatusQueryKeys } from "@/state/queries/host-runtime-status";
import {
  createHostMcpBridgeStatusFixture,
  createHostRuntimeStatusFixture,
} from "@/test-utils/shared-test-fixtures";
import { createHostRuntimeStatusOwner } from "./host-runtime-status-owner";

const snapshot = (
  hostInstanceId: string,
  runtimes: HostRuntimeStatus[],
  mcpBridge = createHostMcpBridgeStatusFixture(),
): HostRuntimeSnapshot => ({ hostInstanceId, runtimes, mcpBridge });

const createDeadlineClock = () => {
  const callbacks = new Set<() => void>();
  const scheduleTask: ScheduleTask = (callback) => {
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  };
  return {
    scheduleTask,
    expire: () => {
      for (const callback of callbacks) callback();
    },
    pending: () => callbacks.size,
  };
};

const createHarness = (scheduleTask: ScheduleTask = defaultScheduleTask) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const events: string[] = [];
  let listener: RuntimeChangeListener | null = null;
  const baselines: Array<PromiseWithResolvers<HostRuntimeSnapshot>> = [];
  const subscribeRuntimeChanges = mock(async (nextListener: RuntimeChangeListener) => {
    events.push("subscribe");
    listener = nextListener;
    return () => {
      events.push("unsubscribe");
    };
  });
  const runtimeStatus = mock(() => {
    events.push("baseline");
    const baseline = Promise.withResolvers<HostRuntimeSnapshot>();
    baselines.push(baseline);
    return baseline.promise;
  });
  const onRuntimeGenerationChange = mock(
    (_kind: HostRuntimeStatus["kind"], _status: HostRuntimeStatus) => {},
  );
  const owner = createHostRuntimeStatusOwner({
    queryClient,
    scheduleTask,
    ports: { subscribeRuntimeChanges, runtimeStatus },
    onRuntimeGenerationChange,
  });
  const emit: RuntimeChangeListener = (event) => {
    if (!listener) throw new Error("The owner has not subscribed.");
    listener(event);
  };
  const readSnapshot = () =>
    queryClient.getQueryData<HostStatusSnapshot>(hostRuntimeStatusQueryKeys.snapshot);
  const lastBaseline = () => {
    const baseline = baselines.at(-1);
    if (!baseline) throw new Error("No baseline read started.");
    return baseline;
  };
  return {
    queryClient,
    owner,
    events,
    emit,
    readSnapshot,
    lastBaseline,
    runtimeStatus,
    subscribeRuntimeChanges,
    onRuntimeGenerationChange,
  };
};

describe("createHostRuntimeStatusOwner", () => {
  test("subscribes before the baseline and keeps newer event revisions over a late baseline", async () => {
    const harness = createHarness();
    harness.owner.start();
    await waitFor(() => expect(harness.events).toEqual(["subscribe", "baseline"]));

    harness.emit({
      type: "runtime_changed",
      hostInstanceId: "host-1",
      status: createHostRuntimeStatusFixture({ kind: "opencode", state: "error", revision: 5 }),
    });
    const readyBridge = createHostMcpBridgeStatusFixture({ state: "ready", revision: 1 });
    harness.emit({ type: "mcp_bridge_changed", hostInstanceId: "host-1", status: readyBridge });
    harness
      .lastBaseline()
      .resolve(
        snapshot(
          "host-1",
          [
            createHostRuntimeStatusFixture({ kind: "opencode", state: "ready", revision: 3 }),
            createHostRuntimeStatusFixture({ kind: "codex", revision: 2 }),
          ],
          createHostMcpBridgeStatusFixture({ state: "starting", hostUrl: null, revision: 0 }),
        ),
      );

    await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));
    expect(harness.readSnapshot()?.runtimes.map((status) => [status.kind, status.state])).toEqual([
      ["opencode", "error"],
      ["codex", "ready"],
    ]);
    expect(harness.readSnapshot()?.mcpBridge).toEqual(readyBridge);
    harness.owner.stop();
  });

  test("replaces the cache for a new host instance and reads a new baseline", async () => {
    const harness = createHarness();
    harness.owner.start();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
    harness
      .lastBaseline()
      .resolve(
        snapshot("host-1", [createHostRuntimeStatusFixture({ kind: "opencode", revision: 9 })]),
      );
    await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));

    harness.emit({
      type: "runtime_changed",
      hostInstanceId: "host-2",
      status: createHostRuntimeStatusFixture({ kind: "codex", state: "starting", revision: 1 }),
    });

    expect(harness.readSnapshot()).toEqual({
      hostInstanceId: "host-2",
      runtimes: [createHostRuntimeStatusFixture({ kind: "codex", state: "starting", revision: 1 })],
      mcpBridge: null,
    });
    expect(harness.owner.getConnection().hasBaseline).toBe(false);
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(2));
    harness.owner.stop();
  });

  test("reports a stream warning as not current and reads one baseline after reconnect", async () => {
    const harness = createHarness();
    harness.owner.start();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
    harness.lastBaseline().resolve(snapshot("host-1", []));
    await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));

    harness.emit({
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "Connection lost.",
    });
    expect(harness.owner.getConnection()).toMatchObject({
      streamError: "Connection lost.",
      hasBaseline: false,
    });

    harness.emit({ __openducktorBrowserLive: true, kind: "reconnected", missedEvents: true });
    expect(harness.owner.getConnection().streamError).toBeNull();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(2));
    harness.lastBaseline().resolve(snapshot("host-1", []));
    await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));
    harness.owner.stop();
  });

  test("a canceled refresh read cannot restore the baseline that a reconnect requires", async () => {
    const harness = createHarness();
    harness.owner.start();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
    harness
      .lastBaseline()
      .resolve(
        snapshot("host-1", [
          createHostRuntimeStatusFixture({ kind: "opencode", state: "ready", revision: 1 }),
        ]),
      );
    await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));

    const refresh = harness.owner.refresh();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(2));
    harness.emit({
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "Connection lost.",
    });
    harness.emit({ __openducktorBrowserLive: true, kind: "reconnected", missedEvents: true });
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(3));
    await refresh;

    expect(harness.owner.getConnection()).toEqual({
      streamError: null,
      readError: null,
      hasBaseline: false,
      isRefreshing: true,
    });

    harness
      .lastBaseline()
      .resolve(
        snapshot("host-1", [
          createHostRuntimeStatusFixture({ kind: "opencode", state: "error", revision: 2 }),
        ]),
      );
    await waitFor(() =>
      expect(harness.owner.getConnection()).toEqual({
        streamError: null,
        readError: null,
        hasBaseline: true,
        isRefreshing: false,
      }),
    );
    expect(harness.readSnapshot()?.runtimes[0]?.state).toBe("error");
    harness.owner.stop();
  });

  test("keeps a connection failure that the transport reports while it subscribes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const owner = createHostRuntimeStatusOwner({
      queryClient,
      ports: {
        subscribeRuntimeChanges: async (listener) => {
          listener({ __openducktorBrowserLive: true, kind: "stream-warning", message: "Lost." });
          return () => {};
        },
        runtimeStatus: async () => snapshot("host-1", []),
      },
      onRuntimeGenerationChange: () => {},
    });
    owner.start();

    await waitFor(() => expect(owner.getConnection().hasBaseline).toBe(true));
    expect(owner.getConnection().streamError).toBe("Lost.");
    owner.stop();
  });

  test("a failure and recovery before the first open end with a current baseline", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const owner = createHostRuntimeStatusOwner({
      queryClient,
      ports: {
        subscribeRuntimeChanges: async (listener) => {
          listener({ __openducktorBrowserLive: true, kind: "stream-warning", message: "Lost." });
          listener({ __openducktorBrowserLive: true, kind: "reconnected", missedEvents: true });
          return () => {};
        },
        runtimeStatus: async () => snapshot("host-1", []),
      },
      onRuntimeGenerationChange: () => {},
    });
    owner.start();

    await waitFor(() =>
      expect(owner.getConnection()).toEqual({
        streamError: null,
        readError: null,
        hasBaseline: true,
        isRefreshing: false,
      }),
    );
    owner.stop();
  });

  test("keeps a failed baseline read visible and never retries it on its own", async () => {
    const harness = createHarness();
    harness.owner.start();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
    harness.lastBaseline().reject(new Error("Host unavailable."));

    await waitFor(() =>
      expect(harness.queryClient.getQueryState(hostRuntimeStatusQueryKeys.snapshot)?.status).toBe(
        "error",
      ),
    );
    expect(harness.owner.getConnection().hasBaseline).toBe(false);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(harness.runtimeStatus).toHaveBeenCalledTimes(1);
    harness.owner.stop();
  });

  test("subscribes again on explicit refresh after a failed subscription", async () => {
    const harness = createHarness();
    harness.subscribeRuntimeChanges.mockImplementationOnce(async () => {
      throw new Error("Event stream unavailable.");
    });
    harness.owner.start();
    await waitFor(() =>
      expect(harness.owner.getConnection().streamError).toBe("Event stream unavailable."),
    );
    harness.lastBaseline().resolve(snapshot("host-1", []));
    await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));

    const resubscribed = Promise.withResolvers<() => void>();
    harness.subscribeRuntimeChanges.mockImplementationOnce(() => {
      harness.events.push("subscribe");
      return resubscribed.promise;
    });
    const refresh = harness.owner.refresh();
    // Until the new subscription is ready and a new baseline succeeds, the cache is not current.
    expect(harness.owner.getConnection()).toMatchObject({ streamError: null, hasBaseline: false });

    resubscribed.resolve(() => {});
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(2));
    expect(harness.owner.getConnection().hasBaseline).toBe(false);
    harness.lastBaseline().resolve(snapshot("host-1", []));
    await refresh;

    expect(harness.subscribeRuntimeChanges).toHaveBeenCalledTimes(2);
    expect(harness.owner.getConnection()).toMatchObject({
      streamError: null,
      readError: null,
      hasBaseline: true,
      isRefreshing: false,
    });
    harness.owner.stop();
  });

  test.each(["initial read", "explicit refresh"])(
    "a stuck %s reports a timeout, releases refresh, and ignores its late result",
    async (mode) => {
      const clock = createDeadlineClock();
      const harness = createHarness(clock.scheduleTask);
      let refresh: Promise<void> | undefined;
      try {
        harness.owner.start();
        await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
        if (mode === "explicit refresh") {
          harness
            .lastBaseline()
            .resolve(
              snapshot("host-1", [
                createHostRuntimeStatusFixture({ kind: "opencode", revision: 1 }),
              ]),
            );
          await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));
          refresh = harness.owner.refresh();
          await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(2));
          expect(harness.owner.getConnection().isRefreshing).toBe(true);
        }
        const stuck = harness.lastBaseline();
        clock.expire();
        await waitFor(() =>
          expect(
            harness.queryClient.getQueryState(hostRuntimeStatusQueryKeys.snapshot)?.error?.message,
          ).toContain("Timed out"),
        );
        await refresh;
        expect(harness.owner.getConnection()).toMatchObject({
          hasBaseline: false,
          isRefreshing: false,
        });
        if (mode === "explicit refresh")
          expect(harness.readSnapshot()?.runtimes[0]?.revision).toBe(1);
        else expect(harness.readSnapshot()).toBeUndefined();
        harness.emit({
          type: "runtime_changed",
          hostInstanceId: "host-1",
          status: createHostRuntimeStatusFixture({ kind: "opencode", revision: 2 }),
        });
        // A live event updates one row; it cannot prove that the full baseline read succeeded.
        expect(
          harness.queryClient.getQueryState(hostRuntimeStatusQueryKeys.snapshot)?.error,
        ).toBeNull();
        expect(harness.owner.getConnection()).toMatchObject({
          hasBaseline: false,
          readError: expect.stringContaining("Timed out"),
        });
        const recovered = harness.owner.refresh();
        await waitFor(() =>
          expect(harness.runtimeStatus).toHaveBeenCalledTimes(mode === "initial read" ? 2 : 3),
        );
        harness
          .lastBaseline()
          .resolve(
            snapshot("host-1", [createHostRuntimeStatusFixture({ kind: "opencode", revision: 2 })]),
          );
        await recovered;
        // A response from a timed-out request must not replace the successful current baseline.
        stuck.resolve(
          snapshot("old-host", [
            createHostRuntimeStatusFixture({ kind: "opencode", revision: 99 }),
          ]),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(harness.readSnapshot()?.hostInstanceId).toBe("host-1");
        expect(harness.readSnapshot()?.runtimes[0]?.revision).toBe(2);
        expect(harness.owner.getConnection()).toMatchObject({
          hasBaseline: true,
          readError: null,
          isRefreshing: false,
        });
        expect(
          harness.queryClient.getQueryState(hostRuntimeStatusQueryKeys.snapshot)?.error,
        ).toBeNull();
        expect(clock.pending()).toBe(0);
      } finally {
        harness.owner.stop();
        harness.queryClient.clear();
      }
    },
  );

  test.each(["after recovery", "with timeout"])(
    "cleans up a timed-out subscription that registers %s",
    async (when) => {
      const clock = createDeadlineClock();
      const harness = createHarness(clock.scheduleTask);
      const registered = Promise.withResolvers<() => void>();
      const stopLateSubscription = mock(() => {});
      let staleListener: RuntimeChangeListener | undefined;
      try {
        harness.owner.start();
        await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
        harness.lastBaseline().resolve(snapshot("host-1", []));
        await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));
        harness.emit({ __openducktorBrowserLive: true, kind: "stream-warning", message: "Lost." });
        harness.subscribeRuntimeChanges.mockImplementationOnce((listener) => {
          staleListener = listener;
          return registered.promise;
        });
        const refresh = harness.owner.refresh();
        await waitFor(() => expect(harness.subscribeRuntimeChanges).toHaveBeenCalledTimes(2));
        clock.expire();
        if (when === "with timeout") registered.resolve(stopLateSubscription);
        await waitFor(() =>
          expect(harness.owner.getConnection().streamError).toContain("Timed out"),
        );
        await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(2));
        harness.lastBaseline().resolve(snapshot("host-1", []));
        await refresh;
        expect(harness.owner.getConnection().isRefreshing).toBe(false);
        const recovered = harness.owner.refresh();
        await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(3));
        harness.lastBaseline().resolve(snapshot("host-1", []));
        await recovered;
        if (when === "after recovery") registered.resolve(stopLateSubscription);
        await waitFor(() => expect(stopLateSubscription).toHaveBeenCalledTimes(1));
        staleListener?.({
          __openducktorBrowserLive: true,
          kind: "stream-warning",
          message: "Stale failure.",
        });
        expect(harness.owner.getConnection()).toEqual({
          streamError: null,
          readError: null,
          hasBaseline: true,
          isRefreshing: false,
        });
        expect(clock.pending()).toBe(0);
      } finally {
        registered.resolve(stopLateSubscription);
        harness.owner.stop();
        harness.queryClient.clear();
      }
    },
  );

  test.each(["reading", "canceling an earlier read"])(
    "stop releases a refresh while %s",
    async (phase) => {
      const clock = createDeadlineClock();
      const harness = createHarness(clock.scheduleTask);
      const cancel = Promise.withResolvers<void>();
      let cancelQueries: ReturnType<typeof spyOn> | undefined;
      try {
        harness.owner.start();
        await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
        harness.lastBaseline().resolve(snapshot("host-1", []));
        await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));
        if (phase === "canceling an earlier read") {
          cancelQueries = spyOn(harness.queryClient, "cancelQueries").mockImplementationOnce(
            () => cancel.promise,
          );
        }
        const refresh = harness.owner.refresh();
        await waitFor(() =>
          phase === "reading"
            ? expect(harness.runtimeStatus).toHaveBeenCalledTimes(2)
            : expect(cancelQueries).toHaveBeenCalledTimes(1),
        );
        harness.owner.stop();
        cancel.resolve();
        await refresh;
        expect(clock.pending()).toBe(0);
        expect(harness.runtimeStatus).toHaveBeenCalledTimes(phase === "reading" ? 2 : 1);
        if (phase === "reading") {
          harness.lastBaseline().resolve(snapshot("old-host", []));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        expect(harness.readSnapshot()?.hostInstanceId).toBe("host-1");
        expect(harness.owner.getConnection().isRefreshing).toBe(false);
      } finally {
        cancel.resolve();
        cancelQueries?.mockRestore();
        harness.owner.stop();
        harness.queryClient.clear();
      }
    },
  );

  test("reports a runtime generation change once per kind", async () => {
    const harness = createHarness();
    harness.owner.start();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
    harness
      .lastBaseline()
      .resolve(
        snapshot("host-1", [
          createHostRuntimeStatusFixture({ kind: "opencode", runtimeId: "a", revision: 1 }),
          createHostRuntimeStatusFixture({ kind: "codex", runtimeId: "b", revision: 1 }),
        ]),
      );
    await waitFor(() => expect(harness.owner.getConnection().hasBaseline).toBe(true));
    expect(harness.onRuntimeGenerationChange).not.toHaveBeenCalled();

    const restarting = createHostRuntimeStatusFixture({
      kind: "opencode",
      runtimeId: "a",
      state: "restarting",
      revision: 2,
    });
    harness.emit({ type: "runtime_changed", hostInstanceId: "host-1", status: restarting });
    const replaced = createHostRuntimeStatusFixture({
      kind: "opencode",
      runtimeId: "c",
      revision: 3,
    });
    harness.emit({ type: "runtime_changed", hostInstanceId: "host-1", status: replaced });

    expect(harness.onRuntimeGenerationChange.mock.calls).toEqual([
      ["opencode", restarting],
      ["opencode", replaced],
    ]);
    harness.owner.stop();
  });

  test("shares runtime events and stream changes with event listeners", async () => {
    const harness = createHarness();
    harness.owner.start();
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(1));
    const received: string[] = [];
    const unsubscribe = harness.owner.subscribeEvents({
      onEvent: (event) => received.push(event.type),
      onStreamChange: () => {
        const { error, epoch } = harness.owner.getStreamHealth();
        received.push(`stream:${error ?? "live"}:${epoch}`);
      },
    });

    harness.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] });
    harness.emit({
      type: "runtime_changed",
      hostInstanceId: "host-1",
      status: createHostRuntimeStatusFixture({ kind: "opencode", revision: 2 }),
    });
    harness.emit({ __openducktorBrowserLive: true, kind: "stream-warning", message: "Lost." });
    harness.emit({ __openducktorBrowserLive: true, kind: "reconnected", missedEvents: true });
    unsubscribe();
    harness.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] });

    expect(received).toEqual([
      "runtime_impact_changed",
      "runtime_changed",
      "stream:Lost.:1",
      "stream:live:2",
    ]);
    harness.owner.stop();
  });

  test("reports a recovered subscription to event listeners only when it is ready", async () => {
    const harness = createHarness();
    harness.subscribeRuntimeChanges.mockImplementationOnce(async () => {
      throw new Error("Event stream unavailable.");
    });
    harness.owner.start();
    await waitFor(() =>
      expect(harness.owner.getStreamHealth().error).toBe("Event stream unavailable."),
    );
    harness.lastBaseline().resolve(snapshot("host-1", []));
    const failedEpoch = harness.owner.getStreamHealth().epoch;
    const changes: Array<string | null> = [];
    harness.owner.subscribeEvents({
      onEvent: () => {},
      onStreamChange: () => changes.push(harness.owner.getStreamHealth().error),
    });
    const subscribed = Promise.withResolvers<() => void>();
    harness.subscribeRuntimeChanges.mockImplementationOnce(() => subscribed.promise);

    const refresh = harness.owner.refresh();
    // A read that started before the new subscription cannot clear the failure.
    expect(harness.owner.getStreamHealth().epoch).toBeGreaterThan(failedEpoch);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(changes).toEqual([]);

    subscribed.resolve(() => {});
    await waitFor(() => expect(changes).toEqual([null]));
    await waitFor(() => expect(harness.runtimeStatus).toHaveBeenCalledTimes(2));
    harness.lastBaseline().resolve(snapshot("host-1", []));
    await refresh;
    harness.owner.stop();
  });
});
