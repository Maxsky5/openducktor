import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { RemoteFailure } from "@openducktor/contracts";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import {
  type AppActivity,
  type AppActivitySource,
  type DeviceNetwork,
  type DeviceNetworkSource,
  RESUME_GRACE_MS,
  startLifecycleController,
} from "./lifecycle-controller";

const source = <Value>(initial: Value) => {
  let value = initial;
  const listeners = new Set<(next: Value) => void>();
  return {
    current: () => value,
    subscribe(listener: (next: Value) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(next: Value) {
      value = next;
      for (const listener of listeners) listener(next);
    },
  };
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const setup = (
  activity: AppActivity = "foreground",
  online = true,
  networkType: DeviceNetwork["type"] = "WIFI",
  backgroundGraceMs = 0,
) => {
  const activitySource = source<AppActivity>(activity);
  let refreshes = 0;
  const networkSource = {
    ...source<DeviceNetwork>({ isConnected: online, type: networkType }),
    refresh: () => {
      refreshes += 1;
    },
  };
  const calls: string[] = [];
  const connection = source<RemoteConnectionState>({ status: "connected", generation: 1 });
  let save = deferred();
  const failures: unknown[] = [];
  let retryFailure: Error | null = null;
  let streamCheck = Promise.resolve(true);
  let streamChecks = 0;
  const controller = startLifecycleController(
    activitySource satisfies AppActivitySource,
    networkSource satisfies DeviceNetworkSource,
    {
      remote: {
        setActive: (active) => {
          calls.push(`setActive:${active}`);
        },
        retry: async () => {
          calls.push("retry");
          if (retryFailure) throw retryFailure;
        },
        readState: connection.current,
        confirmEventStream: () => {
          streamChecks += 1;
          return streamCheck;
        },
        subscribeState: (listener) => {
          listener(connection.current());
          return connection.subscribe(listener);
        },
      },
      saveDrafts: () => {
        calls.push("saveDrafts");
        return save.promise;
      },
      onDraftSaveFailure: (cause) => failures.push(cause),
    },
    backgroundGraceMs,
  );
  return {
    activitySource,
    networkSource,
    connection,
    refreshCount: () => refreshes,
    calls,
    failures,
    controller,
    failRetries(cause: Error) {
      retryFailure = cause;
    },
    silenceStream() {
      streamCheck = Promise.resolve(false);
    },
    streamCheckCount: () => streamChecks,
    resolveSave() {
      save.resolve();
      const current = save;
      save = deferred();
      return current.promise;
    },
    rejectSave(cause: Error) {
      save.reject(cause);
      const current = save;
      save = deferred();
      return current.promise.catch(() => {});
    },
  };
};

const unreachable: RemoteFailure = {
  code: "unavailable",
  message: "The host did not answer.",
  nextAction: "Check the network, then retry.",
  transportCause: "network",
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  setSystemTime();
});

describe("lifecycle controller", () => {
  test("activates the connection in the foreground with a network link", () => {
    const { calls } = setup();
    expect(calls).toEqual(["setActive:true"]);
  });

  test("saves drafts at once and deactivates after the grace period and the save", async () => {
    const { activitySource, calls, resolveSave, controller } = setup();
    activitySource.emit("background");
    expect(calls).toEqual(["setActive:true", "saveDrafts"]);
    await flush();
    expect(calls).toEqual(["setActive:true", "saveDrafts"]);
    expect(controller.resuming()).toBe(false);
    await resolveSave();
    await flush();
    expect(calls).toEqual(["setActive:true", "saveDrafts", "setActive:false"]);
    // Live changes wait from the close, so the views that need them show it before the return.
    expect(controller.resuming()).toBe(true);
    activitySource.emit("foreground");
    expect(calls.at(-1)).toBe("setActive:true");
  });

  test("reads the link again on return, because Android reports its background block as no link", async () => {
    const { activitySource, networkSource, calls, refreshCount, resolveSave } = setup();
    activitySource.emit("background");
    // Android blocks the network of the app in the background.
    networkSource.emit({ isConnected: false, type: "NONE" });
    await resolveSave();
    await flush();
    expect(calls).toEqual(["setActive:true", "saveDrafts", "setActive:false"]);
    activitySource.emit("foreground");
    expect(refreshCount()).toBe(1);
    expect(calls.at(-1)).toBe("setActive:false");
    // The block ended with no network event; the new read finds the link.
    networkSource.emit({ isConnected: true, type: "WIFI" });
    expect(calls.at(-1)).toBe("setActive:true");
  });

  test("keeps the connection when the app returns within the grace period", async () => {
    const { activitySource, calls, resolveSave } = setup("foreground", true, "WIFI", 60_000);
    activitySource.emit("background");
    await resolveSave();
    activitySource.emit("foreground");
    await flush();
    expect(calls).toEqual(["setActive:true", "saveDrafts"]);
  });

  test("restarts a connection that stayed open longer than the grace period", async () => {
    const { activitySource, calls, resolveSave, controller } = setup(
      "foreground",
      true,
      "WIFI",
      60_000,
    );
    activitySource.emit("background");
    // A suspended app runs no timers, so only the clock moves.
    setSystemTime(new Date(Date.now() + 120_000));
    activitySource.emit("foreground");
    expect(calls).toEqual(["setActive:true", "saveDrafts", "retry"]);
    // The old stream can have missed live changes, so the restart counts as a resume.
    expect(controller.resuming()).toBe(true);
    await resolveSave();
    controller.stop();
  });

  test("checks the stream after a pause and keeps a stream that delivers its heartbeat", async () => {
    const { activitySource, calls, resolveSave, streamCheckCount, controller } = setup(
      "foreground",
      true,
      "WIFI",
      60_000,
    );
    activitySource.emit("background");
    setSystemTime(new Date(Date.now() + 20_000));
    activitySource.emit("foreground");
    await flush();
    expect(streamCheckCount()).toBe(1);
    expect(calls).toEqual(["setActive:true", "saveDrafts"]);
    expect(controller.resuming()).toBe(false);
    await resolveSave();
    controller.stop();
  });

  test("restarts a stream that stays silent after a pause, and resumes until an outcome", async () => {
    const { activitySource, connection, calls, resolveSave, silenceStream, controller } = setup(
      "foreground",
      true,
      "WIFI",
      60_000,
    );
    silenceStream();
    activitySource.emit("background");
    setSystemTime(new Date(Date.now() + 20_000));
    activitySource.emit("foreground");
    await flush();
    expect(calls).toEqual(["setActive:true", "saveDrafts", "retry"]);
    expect(controller.resuming()).toBe(true);
    connection.emit({ status: "connected", generation: 2 });
    expect(controller.resuming()).toBe(false);
    await resolveSave();
    controller.stop();
  });

  test("checks no stream after a short absence", async () => {
    const { activitySource, streamCheckCount, resolveSave, controller } = setup(
      "foreground",
      true,
      "WIFI",
      60_000,
    );
    activitySource.emit("background");
    setSystemTime(new Date(Date.now() + 2_000));
    activitySource.emit("foreground");
    await flush();
    expect(streamCheckCount()).toBe(0);
    await resolveSave();
    controller.stop();
  });

  test("restarts a connection that stayed open when the link type changed meanwhile", () => {
    const { activitySource, networkSource, calls } = setup("foreground", true, "WIFI", 60_000);
    activitySource.emit("background");
    networkSource.emit({ isConnected: true, type: "CELLULAR" });
    expect(calls).toEqual(["setActive:true", "saveDrafts"]);
    activitySource.emit("foreground");
    expect(calls).toEqual(["setActive:true", "saveDrafts", "retry"]);
  });

  test("restarts a connection that stayed open when the link dropped and came back meanwhile", () => {
    const { activitySource, networkSource, calls } = setup("foreground", true, "WIFI", 60_000);
    activitySource.emit("background");
    networkSource.emit({ isConnected: false, type: "NONE" });
    networkSource.emit({ isConnected: true, type: "WIFI" });
    expect(calls).toEqual(["setActive:true", "saveDrafts"]);
    activitySource.emit("foreground");
    expect(calls).toEqual(["setActive:true", "saveDrafts", "retry"]);
  });

  test("keeps the connection after a short absence with no link change, as for a photo picker", () => {
    const { activitySource, networkSource, calls } = setup("foreground", true, null, 60_000);
    activitySource.emit("background");
    // The first device read only gives the link type. It is not a link change.
    networkSource.emit({ isConnected: true, type: "WIFI" });
    activitySource.emit("foreground");
    expect(calls).toEqual(["setActive:true", "saveDrafts"]);
  });

  test("restarts a connection that failed in the background and resumes until an outcome", () => {
    const { activitySource, connection, calls, controller } = setup(
      "foreground",
      true,
      "WIFI",
      60_000,
    );
    const resuming: boolean[] = [];
    controller.subscribeResuming((value) => resuming.push(value));
    activitySource.emit("background");
    // Android blocks the network of the app in the background, so the stream fails.
    connection.emit({ status: "disconnected", generation: 1, failure: unreachable });
    expect(controller.resuming()).toBe(false);
    activitySource.emit("foreground");
    expect(calls).toEqual(["setActive:true", "saveDrafts", "retry"]);
    expect(controller.resuming()).toBe(true);
    // The restart publishes states without a failure first.
    connection.emit({ status: "idle", generation: 2 });
    connection.emit({ status: "connecting", generation: 2 });
    connection.emit({ status: "synchronizing", generation: 2 });
    expect(controller.resuming()).toBe(true);
    connection.emit({ status: "connected", generation: 2 });
    expect(controller.resuming()).toBe(false);
    expect(resuming).toEqual([true, false]);
  });

  test("keeps resuming through a failure soon after the return, as a VPN wakes up", () => {
    const { activitySource, connection, controller } = setup("foreground", true, "WIFI", 60_000);
    activitySource.emit("background");
    connection.emit({ status: "disconnected", generation: 1, failure: unreachable });
    activitySource.emit("foreground");
    connection.emit({ status: "connecting", generation: 2 });
    connection.emit({ status: "disconnected", generation: 2, failure: unreachable });
    expect(controller.resuming()).toBe(true);
    connection.emit({ status: "connected", generation: 3 });
    expect(controller.resuming()).toBe(false);
    controller.stop();
  });

  test("ends resuming with a failure after the grace, so the phase shows it", () => {
    const { activitySource, connection, controller } = setup("foreground", true, "WIFI", 60_000);
    activitySource.emit("background");
    connection.emit({ status: "disconnected", generation: 1, failure: unreachable });
    activitySource.emit("foreground");
    connection.emit({ status: "connecting", generation: 2 });
    expect(controller.resuming()).toBe(true);
    setSystemTime(new Date(Date.now() + RESUME_GRACE_MS));
    connection.emit({ status: "disconnected", generation: 2, failure: unreachable });
    expect(controller.resuming()).toBe(false);
  });

  test("ends resuming at once with a permanent failure", () => {
    const { activitySource, connection, controller } = setup("foreground", true, "WIFI", 60_000);
    activitySource.emit("background");
    connection.emit({ status: "disconnected", generation: 1, failure: unreachable });
    activitySource.emit("foreground");
    connection.emit({ status: "failed", generation: 2, failure: unreachable });
    expect(controller.resuming()).toBe(false);
  });

  test("does not resume when the connection stayed connected", () => {
    const { activitySource, controller } = setup("foreground", true, "WIFI", 60_000);
    activitySource.emit("background");
    activitySource.emit("foreground");
    expect(controller.resuming()).toBe(false);
  });

  test("reports a failed draft save and still deactivates", async () => {
    const { activitySource, calls, failures, rejectSave } = setup();
    activitySource.emit("background");
    await rejectSave(new Error("Attachment upload failed."));
    await flush();
    expect(failures).toHaveLength(1);
    expect(calls.at(-1)).toBe("setActive:false");
  });

  test("goes offline without a link and reconnects at once when the link returns", () => {
    const { networkSource, calls, controller } = setup();
    const online: boolean[] = [];
    controller.subscribeDeviceOnline((value) => online.push(value));
    networkSource.emit({ isConnected: false, type: "NONE" });
    expect(controller.deviceOnline()).toBe(false);
    networkSource.emit({ isConnected: true, type: "CELLULAR" });
    expect(calls).toEqual(["setActive:true", "setActive:false", "setActive:true"]);
    expect(online).toEqual([false, true]);
  });

  test("replaces a silent stream when the link type changes", () => {
    const { networkSource, calls } = setup();
    networkSource.emit({ isConnected: true, type: "VPN" });
    expect(calls).toEqual(["setActive:true", "retry"]);
    networkSource.emit({ isConnected: true, type: "VPN" });
    expect(calls).toEqual(["setActive:true", "retry"]);
  });

  test("a failed restart leaves no unhandled rejection", async () => {
    const { networkSource, calls, failRetries } = setup();
    failRetries(new Error("The host did not answer."));
    networkSource.emit({ isConnected: true, type: "CELLULAR" });
    await flush();
    expect(calls).toEqual(["setActive:true", "retry"]);
  });

  test("keeps the startup attempt when the first device read gives the link type", () => {
    const { networkSource, calls } = setup("foreground", true, null);
    networkSource.emit({ isConnected: true, type: "WIFI" });
    expect(calls).toEqual(["setActive:true"]);
    networkSource.emit({ isConnected: true, type: "CELLULAR" });
    expect(calls).toEqual(["setActive:true", "retry"]);
  });

  test("starts inactive in the background or without a link", () => {
    const background = setup("background");
    expect(background.calls).toEqual(["setActive:false"]);
    background.activitySource.emit("foreground");
    expect(background.calls).toEqual(["setActive:false", "setActive:true"]);
    expect(setup("foreground", false).calls).toEqual(["setActive:false"]);
  });

  test("stops listening when stopped", () => {
    const { activitySource, networkSource, calls, controller } = setup();
    controller.stop();
    activitySource.emit("background");
    networkSource.emit({ isConnected: false, type: "NONE" });
    expect(calls).toEqual(["setActive:true"]);
  });
});
