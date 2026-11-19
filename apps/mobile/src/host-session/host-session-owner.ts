import type { RemoteFailure } from "@openducktor/contracts";
import {
  type ClientConnection,
  createClientConnection,
} from "@openducktor/frontend-core/connection/client-connection";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import type { HostConnection } from "@openducktor/frontend-core/connection/host-connection";
import { createMemoryClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import type { AttachmentStager } from "@openducktor/frontend-core/platform/device-file";
import {
  createRemoteHostConnection,
  type RemoteHostConnection,
} from "@openducktor/frontend-core/recovery/remote-host-connection";
import { parseRemoteHostEndpoint } from "@openducktor/frontend-core/recovery/remote-host-endpoint";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { createRemoteTerminalBridge } from "@openducktor/frontend-core/terminals/remote-terminal-bridge";
import type { TerminalBridge } from "@openducktor/frontend-core/terminals/terminal-bridge";
import type { HostClient } from "@openducktor/host-client";
import type {
  RemoteConnectionState,
  RemoteTransport,
  RemoteAuthorizationStore,
  RemoteConnectInput,
} from "@openducktor/host-client/remote";
import { RemoteConnectionError, waitWithAbort } from "@openducktor/host-client/remote";
import {
  type DamagedSavedHost,
  type InvalidDeviceRecord,
  readSavedHosts,
  SELECTED_WORKSPACE_KEY,
  type SavedHost,
  type SavedHostsRecord,
  writeSavedHosts,
} from "../device-data/device-records";
import { createDeviceClientStorage, type DeviceKeyValueStore } from "../device-data/device-store";
import type { LifecycleController } from "./lifecycle-controller";
import type { SessionResourceReader } from "./session-resources";

/** The parts of a session that the views use, for a saved host and for the demo alike. */
type SessionParts = {
  readonly connection: ClientConnection;
  /** The terminal frame transport of this session. */
  readonly terminalBridge: TerminalBridge;
  /** Reads task images and attachment previews of this session. */
  readonly resources: SessionResourceReader;
  /** Changes for each new connection, so React can remount the connection tree. */
  readonly sessionKey: number;
};

/** One connection to a saved host, before or after the app shows it. */
type OpenedHostSession = SessionParts & {
  readonly kind: "remote";
  readonly host: SavedHost;
  readonly remote: RemoteHostConnection;
};

/** The connection to the active saved host. A new session replaces all live state of the old one. */
export type RemoteHostSession = OpenedHostSession & { readonly lifecycle: LifecycleController };

/** The name that the demo shows for its host. */
const DEMO_HOST_LABEL = "Demo host";

/**
 * The demo: fictional sample data in memory on this device. It has no saved host, no address, no
 * credentials, and no connection lifecycle.
 */
export type DemoHostSession = SessionParts & {
  readonly kind: "demo";
  readonly host: { readonly label: typeof DEMO_HOST_LABEL };
};

/** The session that the app shows: a saved host or the demo. */
export type ActiveHostSession = RemoteHostSession | DemoHostSession;

/** The local data source of one demo session. It must not reach a host, a shell, or a model. */
export type DemoSessionAdapter = {
  readonly host: HostConnection;
  readonly terminalBridge: TerminalBridge;
  readonly resources: SessionResourceReader;
  /** The workspace that the demo selects at entry. */
  readonly initialWorkspaceId: string;
  /** Ends the backend for good. The connection calls it last, through `releaseHost`. */
  dispose(): Promise<void>;
};

/** The saved hosts of the device, and the stored entries that the app cannot use. */
type SavedHostLists = { hosts: SavedHost[]; damagedHosts: DamagedSavedHost[] };

export type HostSessionState =
  | ({ status: "no_host" } & SavedHostLists)
  | ({
      status: "switching";
      host: Pick<SavedHost, "label">;
      /** True while the demo closes. It has no drafts to save. */
      demo: boolean;
    } & SavedHostLists)
  | ({ status: "active"; session: ActiveHostSession } & SavedHostLists)
  | {
      status: "invalid_record";
      invalid: InvalidDeviceRecord;
      /** The host IDs that the record still names. The reset deletes their stores. */
      hostIds: string[];
    };

export type HostSessionDependencies = {
  /** The device store for app records, such as the saved host list. */
  appStore: DeviceKeyValueStore;
  /** Opens the separate store of one saved host. */
  openHostStore: (hostId: string) => DeviceKeyValueStore;
  /** Deletes all local data of one saved host. */
  deleteHostStore: (hostId: string) => Promise<void>;
  openAuthorizationStore: (hostId: string) => RemoteAuthorizationStore;
  createTransport: () => RemoteTransport;
  createHostId: () => string;
  /** The app version that the host shows in compatibility failures. */
  appVersion: string;
  feedback: ClientFeedback;
  createAttachmentStager: (
    client: Pick<HostClient, "workspaceStageLocalAttachment">,
  ) => AttachmentStager;
  /** Connects app state and network state to the session that the app shows. */
  startLifecycle: (session: OpenedHostSession) => LifecycleController;
  /**
   * Creates the local backend of one demo session. An abort of `lifetime` stops its scripts,
   * terminals, and events, and fails its open requests.
   */
  createDemoSession: (lifetime: AbortSignal) => DemoSessionAdapter;
};

/** The result of the add host flow. */
type AddHostResult =
  | { kind: "added"; host: SavedHost }
  | { kind: "selected"; host: SavedHost }
  /** A saved host answered at the new address, so it keeps its name and drafts there. */
  | { kind: "moved"; host: SavedHost };

/** An add host failure keeps the user input and shows the host reason with its next action. */
export class AddHostError extends Error {
  constructor(
    message: string,
    readonly failure: RemoteFailure | null,
  ) {
    super(message);
    this.name = "AddHostError";
  }
}

/** A failed draft save keeps the current host, so the user can decide to discard the drafts. */
export class DraftSaveBeforeSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftSaveBeforeSwitchError";
  }
}

type DraftLossConfirmation = (cause: DraftSaveBeforeSwitchError) => Promise<boolean>;

export type HostSessionOwner = {
  getState(): HostSessionState;
  subscribe(listener: () => void): () => void;
  /** Restores the last active host. */
  start(): void;
  /**
   * Connects to a new host and makes it active, or selects the saved host with that address. The
   * address of the active host fails with an `AddHostError`.
   * `label` names a new host; without it, the host takes the name of its address.
   * `discardUnsavedDrafts` continues when the drafts of the current host cannot be saved.
   * `confirmDraftLoss` keeps this approval while the user decides whether to discard drafts.
   * An abort of `signal` before the switch starts keeps the current host and saves nothing.
   */
  addHost(
    address: string,
    options?: {
      signal?: AbortSignal;
      discardUnsavedDrafts?: boolean;
      label?: string;
      pairingCode?: string;
      confirmDraftLoss?: DraftLossConfirmation;
    },
  ): Promise<AddHostResult>;
  selectHost(hostId: string, options?: { discardUnsavedDrafts?: boolean }): Promise<void>;
  renameHost(hostId: string, label: string): void;
  removeHost(hostId: string): Promise<void>;
  /** Removes a damaged entry from the record, and the store of its ID. */
  removeDamagedHost(key: string): Promise<void>;
  /** Removes an unreadable record and the stores of the host IDs that it still names. */
  resetInvalidRecord(): Promise<void>;
  /**
   * Opens the demo with fresh sample data, from host selection or from a connected host. A
   * connected host closes as a host switch does: its drafts save first, and a draft that cannot
   * save fails with `DraftSaveBeforeSwitchError` unless `discardUnsavedDrafts` is set. The saved
   * active host choice does not change, so the next launch opens that host again.
   */
  enterDemo(options?: { discardUnsavedDrafts?: boolean }): Promise<void>;
  /** Discards the demo changes and opens the demo again with fresh sample data. */
  resetDemo(): Promise<void>;
  /** Discards the demo and returns to host selection. */
  exitDemo(): Promise<void>;
  /**
   * The connection tree of demo session `sessionKey` has unmounted and released its resources.
   * `failure` reports a cleanup that failed.
   */
  acknowledgeDemoTreeRelease(sessionKey: number, failure?: Error): void;
};

const failureText = (failure: RemoteFailure): string => `${failure.message} ${failure.nextAction}`;

/**
 * Releases a connection that the app leaves. A failed release cannot stop the switch, so it only
 * goes to the log.
 */
const release = (connection: ClientConnection): Promise<void> =>
  connection
    .dispose()
    .catch((cause: unknown) => console.warn("Host connection release reported a failure", cause));

const defaultLabel = (endpoint: string): string =>
  new URL(endpoint).hostname.replace(/^\[|\]$/g, "");

export const createHostSessionOwner = (deps: HostSessionDependencies): HostSessionOwner => {
  const listeners = new Set<() => void>();
  let record: SavedHostsRecord = { activeHostId: null, hosts: [], damagedHosts: [] };
  let state: HostSessionState = { status: "no_host", hosts: [], damagedHosts: [] };
  let session: ActiveHostSession | null = null;
  let nextSessionKey = 1;
  let transition: Promise<void> = Promise.resolve();
  /** Add host attempts that have not settled. The demo cannot open during one. */
  let pendingAdmissions = 0;
  /** The lifetime of the active demo session. Its abort stops all scripted activity. */
  let demoLifetime: AbortController | null = null;
  /** The demo session whose connection tree the owner waits to unmount. */
  let demoRelease: { sessionKey: number; done: (failure: Error | undefined) => void } | null = null;

  const publish = (next: HostSessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const saveRecord = (next: SavedHostsRecord) => {
    writeSavedHosts(deps.appStore, next);
    record = next;
  };

  /** The demo shows no saved host. The owner keeps the saved lists for host selection. */
  const lists = (): SavedHostLists =>
    session?.kind === "demo"
      ? { hosts: [], damagedHosts: [] }
      : { hosts: record.hosts, damagedHosts: record.damagedHosts };

  const publishIdle = () => {
    publish({ status: "no_host", ...lists() });
  };

  /** Publishes the current lists in the current state, with the current session. */
  const publishLists = () => {
    if (session) publish({ status: "active", ...lists(), session });
    else if (state.status !== "invalid_record") publish({ ...state, ...lists() });
  };

  const openSession = (
    host: SavedHost,
    hostStore: DeviceKeyValueStore,
    initialConnect?: RemoteConnectInput,
  ): OpenedHostSession => {
    const queryClient = createClientQueryClient();
    const remote = createRemoteHostConnection({
      endpoint: host.endpoint,
      version: deps.appVersion,
      transport: deps.createTransport(),
      queryClient,
      clientKind: "mobile",
      authorizationStore: deps.openAuthorizationStore(host.id),
      initialConnect,
    });
    const connection = createClientConnection({
      host: remote,
      queryClient,
      storage: createDeviceClientStorage(hostStore),
      // The drafts stay on the device. `closeSession` saves them only when the user keeps them, so
      // a removed host or discarded drafts upload no attachment.
      saveDraftsOnDispose: false,
      feedback: deps.feedback,
      stageAttachment: deps.createAttachmentStager(remote.client),
      releaseHost: () => remote.remote.disconnect(),
    });
    return {
      kind: "remote",
      host,
      connection,
      remote,
      terminalBridge: createRemoteTerminalBridge(remote),
      resources: {
        readTaskAsset: (context, signal) => remote.remote.readTaskAsset(context, signal),
        readStagedPreview: (path, signal) => remote.remote.readStagedPreview(path, signal),
      },
      sessionKey: nextSessionKey++,
    };
  };

  /** Opens a demo session with fresh sample data in memory. */
  const openDemo = (): DemoHostSession => {
    const lifetime = new AbortController();
    const adapter = deps.createDemoSession(lifetime.signal);
    const storage = createMemoryClientStorage();
    storage.setItem(SELECTED_WORKSPACE_KEY, adapter.initialWorkspaceId);
    const connection = createClientConnection({
      host: adapter.host,
      queryClient: createClientQueryClient(),
      storage,
      // Demo drafts live in memory and end with the demo.
      saveDraftsOnDispose: false,
      feedback: deps.feedback,
      stageAttachment: deps.createAttachmentStager(adapter.host.client),
      releaseHost: () => adapter.dispose(),
    });
    demoLifetime = lifetime;
    return {
      kind: "demo",
      host: { label: DEMO_HOST_LABEL },
      connection,
      terminalBridge: adapter.terminalBridge,
      resources: adapter.resources,
      sessionKey: nextSessionKey++,
    };
  };

  /**
   * Stops the demo, waits until its connection tree has unmounted and released its preview
   * files, then disposes its connection. Demo drafts are discarded. Resolves with the first
   * failure of these steps.
   */
  const releaseDemo = async (current: DemoHostSession): Promise<Error | undefined> => {
    session = null;
    demoLifetime?.abort(new Error("The demo ended."));
    demoLifetime = null;
    const treeReleased = new Promise<Error | undefined>((done) => {
      demoRelease = { sessionKey: current.sessionKey, done };
    });
    publish({ status: "switching", ...lists(), host: current.host, demo: true });
    let failure = await treeReleased;
    try {
      await current.connection.dispose();
    } catch (cause) {
      failure ??= cause instanceof Error ? cause : new Error(errorMessage(cause));
    }
    return failure;
  };

  /** The demo could not release all its resources, so the app shows host selection and the cause. */
  const reportDemoReleaseFailure = (failure: Error) => {
    publishIdle();
    deps.feedback.show("error", "The demo did not close cleanly", {
      description: `${errorMessage(failure)} Restart the app to clear the remaining temporary files.`,
      duration: Infinity,
    });
  };

  const activeDemo = (): DemoHostSession => {
    if (session?.kind !== "demo") throw new Error("The demo is not open.");
    return session;
  };

  /** Real host data stays closed while the demo is open. */
  const assertNoDemo = () => {
    if (session?.kind === "demo") throw new Error("Exit the demo to use a saved host.");
  };

  /** Stops the watch that saves the host ID of the active host. */
  let stopHostIdWatch: (() => void) | null = null;

  /** A saved host from before host IDs gets the ID of its host when it connects. */
  const watchHostId = (opened: OpenedHostSession) => {
    stopHostIdWatch?.();
    stopHostIdWatch = opened.remote.remote.subscribeState((current) => {
      const hostId = current.status === "connected" ? current.host?.hostId : undefined;
      const saved = record.hosts.find((candidate) => candidate.id === opened.host.id);
      if (!hostId || !saved || saved.hostId === hostId) return;
      saveRecord({
        ...record,
        hosts: record.hosts.map((host) => (host.id === saved.id ? { ...host, hostId } : host)),
      });
    });
  };

  const activate = (opened: OpenedHostSession) => {
    const active: RemoteHostSession = { ...opened, lifecycle: deps.startLifecycle(opened) };
    session = active;
    watchHostId(opened);
    publish({ status: "active", ...lists(), session: active });
  };

  /**
   * Unmounts the old tree, then releases its connection. Host work continues. An abort of
   * `signal` before the draft save ends keeps the current host.
   */
  const closeSession = async ({
    discardUnsavedDrafts,
    signal,
    confirmDraftLoss,
  }: {
    discardUnsavedDrafts: boolean;
    signal?: AbortSignal | undefined;
    confirmDraftLoss?: DraftLossConfirmation | undefined;
  }) => {
    assertNoDemo();
    const current = session?.kind === "remote" ? session : null;
    let discard = discardUnsavedDrafts;
    if (current && !discard) {
      try {
        await current.connection.saveDrafts();
      } catch (cause) {
        const failure = new DraftSaveBeforeSwitchError(
          `Some drafts for ${current.host.label} could not be saved: ${errorMessage(cause)} Stay on this host to keep them, or continue and lose the unsaved draft changes.`,
        );
        if (!confirmDraftLoss) throw failure;
        signal?.throwIfAborted();
        const answer = confirmDraftLoss(failure);
        const proceed = await (signal ? waitWithAbort(answer, signal) : answer);
        if (!proceed) throw failure;
        discard = true;
      }
    }
    signal?.throwIfAborted();
    if (!current) return;
    session = null;
    stopHostIdWatch?.();
    stopHostIdWatch = null;
    current.lifecycle.stop();
    publish({ status: "switching", ...lists(), host: current.host, demo: false });
    if (!discard) {
      // The tree stayed open during the first save, so this save writes the edits made meanwhile.
      await current.connection.saveDrafts().catch((cause: unknown) =>
        deps.feedback.show("error", `Some draft changes for ${current.host.label} were not saved`, {
          description: errorMessage(cause),
        }),
      );
    }
    await release(current.connection);
  };

  const serialize = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const next = transition.then(operation);
    transition = next.then(
      () => {},
      () => {},
    );
    return next;
  };

  const findHost = (hostId: string): SavedHost => {
    const host = record.hosts.find((candidate) => candidate.id === hostId);
    if (!host) throw new Error("This saved host no longer exists. Select another host.");
    return host;
  };

  const waitForConnected = (remote: RemoteHostConnection, signal?: AbortSignal) =>
    new Promise<RemoteConnectionState>((resolve, reject) => {
      let settled = false;
      let stop: (() => void) | null = null;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        // subscribeState delivers the current state at once, so stop can be null here.
        queueMicrotask(() => stop?.());
        action();
      };
      const onAbort = () => finish(() => reject(signal?.reason));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      stop = remote.remote.subscribeState((current) => {
        if (current.status === "connected") finish(() => resolve(current));
        else if (current.status === "failed" || current.status === "disconnected") {
          const failure = current.failure ?? null;
          finish(() =>
            reject(
              new AddHostError(
                failure
                  ? failureText(failure)
                  : "The host connection failed. Check the address and retry.",
                failure,
              ),
            ),
          );
        }
      });
    });

  /**
   * The saved host answered at a new address, such as after its network or port changed. It keeps
   * its name, its drafts, and its device store there. The connection to the new address opened
   * with a temporary store, so the saved host opens again with its own.
   */
  const moveHost = async (
    known: SavedHost,
    reached: Pick<SavedHost, "endpoint" | "shell">,
    candidate: OpenedHostSession,
    options: {
      discardUnsavedDrafts: boolean;
      signal?: AbortSignal | undefined;
      confirmDraftLoss?: DraftLossConfirmation | undefined;
    },
  ): Promise<AddHostResult> => {
    await release(candidate.connection);
    try {
      const grant = await deps.openAuthorizationStore(candidate.host.id).read(reached.endpoint);
      if (!grant)
        throw new AddHostError(
          "Saved access is missing on this device. Enter a fresh host code.",
          null,
        );
      // The old access stays until the new address connects, so a failed move keeps the host usable.
      const knownAccess = deps.openAuthorizationStore(known.id);
      const previous = await knownAccess.read(known.endpoint).catch((cause: unknown) => {
        // Damaged saved access cannot connect, so the move has nothing to keep.
        if (
          cause instanceof RemoteConnectionError &&
          cause.failure.code === "authorization_rejected"
        )
          return null;
        throw cause;
      });
      await closeSession(options);
      options.signal?.throwIfAborted();
      await knownAccess.save(grant);
      const moved: SavedHost = { ...known, ...reached, hostId: grant.authorization.hostId };
      const opened = openSession(
        moved,
        deps.openHostStore(known.id),
        options.signal ? { signal: options.signal } : undefined,
      );
      try {
        await waitForConnected(opened.remote, options.signal);
        options.signal?.throwIfAborted();
        await deps.deleteHostStore(candidate.host.id);
        options.signal?.throwIfAborted();
        saveRecord({
          ...record,
          activeHostId: known.id,
          hosts: record.hosts.map((host) => (host.id === known.id ? moved : host)),
        });
        activate(opened);
      } catch (cause) {
        await release(opened.connection);
        if (previous) await knownAccess.save(previous);
        throw cause;
      }
      deps.feedback.show("success", `${known.label} is at a new address`, {
        description: reached.endpoint,
      });
      return { kind: "moved", host: moved };
    } catch (cause) {
      await deps.deleteHostStore(candidate.host.id);
      if (!session) {
        publishIdle();
        deps.feedback.show("error", `Could not move ${known.label}`, {
          description: errorMessage(cause),
        });
      }
      throw cause;
    }
  };

  /** Connects to a new host or a saved host at that address. See `HostSessionOwner.addHost`. */
  const addHost: HostSessionOwner["addHost"] = async (address, options) => {
    assertNoDemo();
    const switchOptions = {
      discardUnsavedDrafts: options?.discardUnsavedDrafts ?? false,
      signal: options?.signal,
      confirmDraftLoss: options?.confirmDraftLoss,
    };
    // The first connection of the opened host takes only the code and the cancel signal.
    const connectInput: RemoteConnectInput = {};
    if (options?.signal) connectInput.signal = options.signal;
    if (options?.pairingCode !== undefined) connectInput.pairingCode = options.pairingCode;
    let endpoint: string;
    try {
      endpoint = parseRemoteHostEndpoint(address, { requireHttps: false });
    } catch (cause) {
      throw new AddHostError(errorMessage(cause), null);
    }
    const existing = record.hosts.find((host) => host.endpoint === endpoint);
    if (existing) {
      if (session?.kind === "remote" && session.host.id === existing.id) {
        throw new AddHostError(
          "OpenDucktor is already connected to this host. Enter the address of another host.",
          null,
        );
      }
      const opened = openSession(existing, deps.openHostStore(existing.id), connectInput);
      try {
        const current = await waitForConnected(opened.remote, options?.signal);
        await closeSession(switchOptions);
        options?.signal?.throwIfAborted();
        const refreshed = { ...existing };
        if (current.host?.hostId) refreshed.hostId = current.host.hostId;
        saveRecord({
          ...record,
          activeHostId: existing.id,
          hosts: record.hosts.map((host) => (host.id === existing.id ? refreshed : host)),
        });
        activate({ ...opened, host: refreshed });
        return { kind: "selected", host: refreshed };
      } catch (cause) {
        await release(opened.connection);
        if (!session) publishIdle();
        throw cause;
      }
    }
    const id = deps.createHostId();
    const candidateHost: SavedHost = {
      id,
      endpoint,
      label: options?.label?.trim() || defaultLabel(endpoint),
      shell: "web",
    };
    const candidate = openSession(candidateHost, deps.openHostStore(id), connectInput);
    // A failed candidate leaves no saved host and no store behind.
    const discardCandidate = async (cause: unknown): Promise<never> => {
      await release(candidate.connection);
      await deps.deleteHostStore(id);
      if (!session) publishIdle();
      throw cause;
    };
    let connected: RemoteConnectionState;
    try {
      connected = await waitForConnected(candidate.remote, options?.signal);
    } catch (cause) {
      return discardCandidate(cause);
    }
    const shell = connected.host?.shell ?? "web";
    const hostId = connected.host?.hostId;
    const known = hostId ? record.hosts.find((saved) => saved.hostId === hostId) : undefined;
    if (known) return moveHost(known, { endpoint, shell }, candidate, switchOptions);
    const host: SavedHost = { ...candidateHost, shell };
    if (hostId) host.hostId = hostId;
    try {
      await closeSession(switchOptions);
      options?.signal?.throwIfAborted();
    } catch (cause) {
      return discardCandidate(cause);
    }
    saveRecord({ ...record, activeHostId: id, hosts: [...record.hosts, host] });
    activate({ ...candidate, host });
    return { kind: "added", host };
  };

  const owner: HostSessionOwner = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      const read = readSavedHosts(deps.appStore);
      if (!read.ok) {
        publish({ status: "invalid_record", invalid: read.invalid, hostIds: read.hostIds });
        return;
      }
      record = read.value;
      const host = record.hosts.find((candidate) => candidate.id === record.activeHostId);
      if (!host) {
        publishIdle();
        return;
      }
      activate(openSession(host, deps.openHostStore(host.id)));
    },
    addHost: (address, options) => {
      pendingAdmissions += 1;
      const attempt = serialize(() => addHost(address, options));
      void attempt.then(
        () => (pendingAdmissions -= 1),
        () => (pendingAdmissions -= 1),
      );
      return attempt;
    },
    selectHost: (hostId, options) =>
      serialize(async () => {
        const host = findHost(hostId);
        assertNoDemo();
        if (session?.kind === "remote" && session.host.id === hostId) return;
        await closeSession({ discardUnsavedDrafts: options?.discardUnsavedDrafts ?? false });
        saveRecord({ ...record, activeHostId: hostId });
        activate(openSession(host, deps.openHostStore(host.id)));
      }),
    renameHost(hostId, label) {
      const trimmed = label.trim();
      if (!trimmed) throw new Error("Enter a host name.");
      findHost(hostId);
      saveRecord({
        ...record,
        hosts: record.hosts.map((host) =>
          host.id === hostId ? { ...host, label: trimmed } : host,
        ),
      });
      if (session?.kind === "remote" && session.host.id === hostId) {
        session = { ...session, host: { ...session.host, label: trimmed } };
      }
      publishLists();
    },
    removeHost: (hostId) =>
      serialize(async () => {
        const host = findHost(hostId);
        assertNoDemo();
        const wasActive = session?.kind === "remote" && session.host.id === hostId;
        // The user confirmed that unsent drafts of this host are deleted.
        if (wasActive) await closeSession({ discardUnsavedDrafts: true });
        try {
          await deps.deleteHostStore(hostId);
        } catch (cause) {
          if (wasActive) {
            publishIdle();
            deps.feedback.show("error", `Could not remove ${host.label}`, {
              description: errorMessage(cause),
            });
          }
          throw cause;
        }
        saveRecord({
          ...record,
          activeHostId: record.activeHostId === hostId ? null : record.activeHostId,
          hosts: record.hosts.filter((host) => host.id !== hostId),
        });
        if (session) publish({ status: "active", ...lists(), session });
        else publishIdle();
      }),
    removeDamagedHost: (key) =>
      serialize(async () => {
        const entry = record.damagedHosts.find((candidate) => candidate.key === key);
        if (!entry) throw new Error("This damaged host is already removed.");
        // A saved host with the same ID owns that store, so the store stays. The app never opens
        // the store of a damaged entry, so the store can go.
        if (entry.id !== null && !record.hosts.some((host) => host.id === entry.id)) {
          await deps.deleteHostStore(entry.id);
        }
        saveRecord({
          ...record,
          damagedHosts: record.damagedHosts.filter((candidate) => candidate !== entry),
        });
        publishLists();
      }),
    resetInvalidRecord: () =>
      serialize(async () => {
        if (state.status !== "invalid_record") return;
        // The app opens no host store before it can read the record, so each store can go.
        for (const hostId of state.hostIds) {
          // Stop at the first failed deletion and keep the record for a retry.
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          await deps.deleteHostStore(hostId);
        }
        deps.appStore.remove(state.invalid.key);
        owner.start();
      }),
    enterDemo(options) {
      // A host connection from host selection runs, so the demo waits for its result.
      if (pendingAdmissions > 0)
        return Promise.reject(
          new Error("A host connection is in progress. Wait for it to end, then try the demo."),
        );
      return serialize(async () => {
        if (session?.kind === "remote")
          await closeSession({ discardUnsavedDrafts: options?.discardUnsavedDrafts ?? false });
        else if (state.status !== "no_host" || session)
          throw new Error("Open host selection to try the demo.");
        const demo = openDemo();
        session = demo;
        publish({ status: "active", ...lists(), session: demo });
      });
    },
    resetDemo: () =>
      serialize(async () => {
        const failure = await releaseDemo(activeDemo());
        if (failure) {
          reportDemoReleaseFailure(failure);
          return;
        }
        const demo = openDemo();
        session = demo;
        publish({ status: "active", ...lists(), session: demo });
        deps.feedback.show("success", "Demo reset");
      }),
    exitDemo: () =>
      serialize(async () => {
        const failure = await releaseDemo(activeDemo());
        if (failure) reportDemoReleaseFailure(failure);
        else publishIdle();
      }),
    acknowledgeDemoTreeRelease(sessionKey, failure) {
      if (demoRelease?.sessionKey !== sessionKey) return;
      const { done } = demoRelease;
      demoRelease = null;
      done(failure);
    },
  };
  return owner;
};
