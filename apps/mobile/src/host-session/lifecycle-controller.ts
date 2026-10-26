import type { RemoteHostClient } from "@openducktor/host-client/remote";

export type AppActivity = "foreground" | "background";

/** The device app state. React Native `AppState` gives it; `inactive` counts as foreground. */
export type AppActivitySource = {
  current(): AppActivity;
  subscribe(listener: (activity: AppActivity) => void): () => void;
};

export type DeviceNetwork = {
  /** False only when the device reports no network link. Unknown counts as connected. */
  isConnected: boolean;
  /** The link type, such as `WIFI`, `CELLULAR`, or `VPN`. Null until the first device read. */
  type: string | null;
};

/** The device network state. It reports a link, not internet reachability. */
export type DeviceNetworkSource = {
  current(): DeviceNetwork;
  subscribe(listener: (network: DeviceNetwork) => void): () => void;
  /** Reads the link again and reports a change to the listeners. */
  refresh(): void;
};

export type LifecycleTarget = {
  remote: Pick<
    RemoteHostClient,
    "setActive" | "retry" | "readState" | "subscribeState" | "confirmEventStream"
  >;
  /** Writes unsaved drafts. It must finish before deactivation aborts requests in flight. */
  saveDrafts(): Promise<void>;
  onDraftSaveFailure(cause: unknown): void;
};

export type LifecycleController = {
  deviceOnline(): boolean;
  subscribeDeviceOnline(listener: (online: boolean) => void): () => void;
  /**
   * True from a return to the foreground without a live connection, or with a stale one, until
   * the connection connects or fails again. It is also true from the close of the connection in
   * the background. A failure then comes from the background, where Android blocks the network of
   * the app, so it says nothing about the host. Live changes wait during this time.
   */
  resuming(): boolean;
  subscribeResuming(listener: (resuming: boolean) => void): () => void;
  stop(): void;
};

/**
 * How long the app can stay in the background before the connection closes. Android reports the
 * photo picker, the share sheet, and permission dialogs as background, so a short absence keeps the
 * connection and its commands in flight.
 */
export const BACKGROUND_GRACE_MS = 60_000;

/**
 * A background period this long can end the host stream without a close: Android freezes a
 * background app after about 10 seconds, and a network path can drop an idle flow, as a VPN or a
 * Wi-Fi power save does. So a return after it checks the stream.
 */
const STREAM_CHECK_PAUSE_MS = 5_000;

/**
 * How long after a return a failed attempt still shows as Reconnecting. A VPN or a Wi-Fi radio can
 * need a few seconds after unlock, so the first attempts can fail before the path is up. A
 * permanent failure shows at once.
 */
export const RESUME_GRACE_MS = 5_000;

type BackgroundPeriod = {
  since: number;
  /** True when the device lost its link or changed link type during the period. */
  linkChanged: boolean;
  /** True after the grace period ended and the draft save settled. */
  expired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Keeps the remote connection active while the app is in the foreground with a network link, and
 * for `backgroundGraceMs` after the app goes to the background. An old stream can stay silent
 * after a network change. host-client finds a silent stream only after three missed heartbeats,
 * and not at all for a host without the heartbeat capability. So a changed link starts a new
 * attempt at once. For the same reason, a connection that stayed open restarts on return when the
 * link dropped or changed type in the background, or the app was away longer than the grace period,
 * as after an iOS suspension. The restart runs the recovery barrier before commands open again.
 * A connection that is not connected on return also restarts at once, and it is `resuming` until
 * the restart connects, fails for good, or still fails after `RESUME_GRACE_MS`. After a shorter absence of at least `STREAM_CHECK_PAUSE_MS`, the
 * stream must deliver its heartbeat. A stream that stays silent, or a host without heartbeats,
 * restarts the same way.
 */
export const startLifecycleController = (
  activitySource: AppActivitySource,
  networkSource: DeviceNetworkSource,
  target: LifecycleTarget,
  backgroundGraceMs: number,
): LifecycleController => {
  let activity = activitySource.current();
  let network = networkSource.current();
  let stopped = false;
  let background: BackgroundPeriod | null =
    activity === "background"
      ? { since: Date.now(), linkChanged: false, expired: true, timer: null }
      : null;
  const onlineListeners = new Set<(online: boolean) => void>();
  const resumingListeners = new Set<(resuming: boolean) => void>();
  let resuming = false;
  let resumedAt = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  const setResuming = (next: boolean) => {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = null;
    if (next) resumedAt = Date.now();
    if (next === resuming) return;
    resuming = next;
    for (const listener of resumingListeners) listener(next);
  };

  const shouldBeActive = () => network.isConnected && (background === null || !background.expired);
  let active = shouldBeActive();
  target.remote.setActive(active);

  // The connection state and the connection phase show a failed restart.
  const restart = () => void target.remote.retry().catch(() => {});

  let streamChecks = 0;
  const checkStream = () => {
    const check = ++streamChecks;
    void target.remote.confirmEventStream().then((alive) => {
      if (alive || stopped || background !== null || check !== streamChecks || !active) return;
      setResuming(true);
      restart();
    });
  };

  const apply = () => {
    const next = shouldBeActive();
    if (next === active) return;
    active = next;
    target.remote.setActive(next);
  };

  const enterBackground = () => {
    // Drafts are written at once, because the system can suspend or end the app at any time.
    const save = target.saveDrafts().catch((cause) => target.onDraftSaveFailure(cause));
    const period: BackgroundPeriod = {
      since: Date.now(),
      linkChanged: false,
      expired: false,
      timer: null,
    };
    background = period;
    period.timer = setTimeout(() => {
      period.timer = null;
      // Deactivation aborts requests in flight, such as the attachment uploads of the draft save.
      void save.finally(() => {
        if (stopped || background !== period) return;
        period.expired = true;
        apply();
        // The views that wait for live changes show it before the app returns.
        if (!active) setResuming(true);
      });
    }, backgroundGraceMs);
  };

  const enterForeground = () => {
    const period = background;
    background = null;
    if (!period) return;
    // The states that the return publishes, such as the restart, keep `resuming` until an outcome.
    const lost = target.remote.readState().status !== "connected";
    const pausedMs = Date.now() - period.since;
    const stale = period.linkChanged || pausedMs >= backgroundGraceMs;
    // A stale stream can have missed live changes, as after a freeze that held the close timer.
    if (lost || stale) setResuming(true);
    // Android blocks the network of an app in the background, and the device source reads the
    // block as no link. The end of the block comes with no network event, so the app reads the
    // link again when it returns.
    networkSource.refresh();
    if (period.timer) clearTimeout(period.timer);
    const wasActive = active;
    apply();
    if (!wasActive || !active) return;
    // A lost connection can wait for its next automatic attempt for up to 15 seconds.
    if (stale || lost) restart();
    else if (pausedMs >= STREAM_CHECK_PAUSE_MS) checkStream();
  };

  const stopState = target.remote.subscribeState((state) => {
    if (stopped || !resuming) return;
    if (state.status === "connected" || state.status === "failed") {
      setResuming(false);
      return;
    }
    if (state.failure === undefined || resumeTimer) return;
    // A failure within the grace shows as Reconnecting while the next attempts run.
    const left = RESUME_GRACE_MS - (Date.now() - resumedAt);
    if (left <= 0) {
      setResuming(false);
      return;
    }
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!stopped && target.remote.readState().status !== "connected") setResuming(false);
    }, left);
  });

  const stopActivity = activitySource.subscribe((next) => {
    if (stopped || next === activity) return;
    activity = next;
    if (next === "background") enterBackground();
    else enterForeground();
  });

  const stopNetwork = networkSource.subscribe((next) => {
    if (stopped) return;
    const previous = network;
    network = next;
    if (previous.isConnected !== next.isConnected) {
      for (const listener of onlineListeners) listener(next.isConnected);
    }
    // The return to the foreground applies the link state of the background period. A link that
    // dropped or changed meanwhile can leave the old stream silent, even when it comes back.
    if (background) {
      if (!next.isConnected || (previous.type !== null && previous.type !== next.type))
        background.linkChanged = true;
      return;
    }
    const wasActive = active;
    apply();
    // A new link type keeps the active flag, so the old stream must be replaced explicitly. The
    // first device read is not a change, so it keeps the attempt that startup began.
    if (wasActive && active && previous.type !== null && previous.type !== next.type) restart();
  });

  return {
    deviceOnline: () => network.isConnected,
    resuming: () => resuming,
    subscribeResuming(listener) {
      resumingListeners.add(listener);
      return () => {
        resumingListeners.delete(listener);
      };
    },
    subscribeDeviceOnline(listener) {
      onlineListeners.add(listener);
      return () => {
        onlineListeners.delete(listener);
      };
    },
    stop() {
      stopped = true;
      if (background?.timer) clearTimeout(background.timer);
      if (resumeTimer) clearTimeout(resumeTimer);
      stopActivity();
      stopNetwork();
      stopState();
      onlineListeners.clear();
      resumingListeners.clear();
    },
  };
};
