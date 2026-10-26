import type { RemoteFailure } from "@openducktor/contracts";
import {
  type ClientConnection,
  createClientConnection,
} from "@openducktor/frontend-core/connection/client-connection";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import type { AttachmentStager } from "@openducktor/frontend-core/platform/device-file";
import {
  createRemoteHostConnection,
  type RemoteHostConnection,
} from "@openducktor/frontend-core/recovery/remote-host-connection";
import { parseRemoteHostEndpoint } from "@openducktor/frontend-core/recovery/remote-host-endpoint";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { RemoteConnectionState, RemoteTransport } from "@openducktor/host-client/remote";
import {
  type DamagedSavedHost,
  type InvalidDeviceRecord,
  readSavedHosts,
  type SavedHost,
  type SavedHostsRecord,
  writeSavedHosts,
} from "../device-data/device-records";
import { createDeviceClientStorage, type DeviceKeyValueStore } from "../device-data/device-store";
import type { LifecycleController } from "./lifecycle-controller";

/** One connection to a saved host, before or after the app shows it. */
type OpenedHostSession = {
  readonly host: SavedHost;
  readonly connection: ClientConnection;
  readonly remote: RemoteHostConnection;
  /** Changes for each new connection, so React can remount the connection tree. */
  readonly sessionKey: number;
};

/** The connection to the active saved host. A new session replaces all live state of the old one. */
export type ActiveHostSession = OpenedHostSession & { readonly lifecycle: LifecycleController };

/** The saved hosts of the device, and the stored entries that the app cannot use. */
type SavedHostLists = { hosts: SavedHost[]; damagedHosts: DamagedSavedHost[] };

export type HostSessionState =
  | ({ status: "no_host" } & SavedHostLists)
  | ({ status: "switching"; host: SavedHost } & SavedHostLists)
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
  deleteHostStore: (hostId: string) => void;
  createTransport: () => RemoteTransport;
  createHostId: () => string;
  /** The app version that the host shows in compatibility failures. */
  appVersion: string;
  feedback: ClientFeedback;
  createAttachmentStager: (remote: RemoteHostConnection) => AttachmentStager;
  /** Connects app state and network state to the session that the app shows. */
  startLifecycle: (session: OpenedHostSession) => LifecycleController;
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
   * An abort of `signal` before the switch starts keeps the current host and saves nothing.
   */
  addHost(
    address: string,
    options?: { signal?: AbortSignal; discardUnsavedDrafts?: boolean; label?: string },
  ): Promise<AddHostResult>;
  selectHost(hostId: string, options?: { discardUnsavedDrafts?: boolean }): Promise<void>;
  renameHost(hostId: string, label: string): void;
  removeHost(hostId: string): Promise<void>;
  /** Removes a damaged entry from the record, and the store of its ID. */
  removeDamagedHost(key: string): void;
  /** Removes an unreadable record and the stores of the host IDs that it still names. */
  resetInvalidRecord(): void;
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

  const publish = (next: HostSessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const saveRecord = (next: SavedHostsRecord) => {
    writeSavedHosts(deps.appStore, next);
    record = next;
  };

  const lists = (): SavedHostLists => ({
    hosts: record.hosts,
    damagedHosts: record.damagedHosts,
  });

  const publishIdle = () => {
    publish({ status: "no_host", ...lists() });
  };

  /** Publishes the current lists in the current state, with the current session. */
  const publishLists = () => {
    if (session) publish({ status: "active", ...lists(), session });
    else if (state.status !== "invalid_record") publish({ ...state, ...lists() });
  };

  const openSession = (host: SavedHost, hostStore: DeviceKeyValueStore): OpenedHostSession => {
    const queryClient = createClientQueryClient();
    const remote = createRemoteHostConnection({
      endpoint: host.endpoint,
      version: deps.appVersion,
      transport: deps.createTransport(),
      queryClient,
    });
    const connection = createClientConnection({
      host: remote,
      queryClient,
      storage: createDeviceClientStorage(hostStore),
      // The drafts stay on the device. `closeSession` saves them only when the user keeps them, so
      // a removed host or discarded drafts upload no attachment.
      saveDraftsOnDispose: false,
      feedback: deps.feedback,
      stageAttachment: deps.createAttachmentStager(remote),
      releaseHost: () => remote.remote.disconnect(),
    });
    return { host, connection, remote, sessionKey: nextSessionKey++ };
  };

  /** Stops the watch that saves the host ID of the active host. */
  let stopHostIdWatch: (() => void) | null = null;

  /** A saved host from before host IDs gets the ID of its host when it connects. */
  const watchHostId = (opened: OpenedHostSession) => {
    stopHostIdWatch?.();
    stopHostIdWatch = opened.remote.remote.subscribeState((current) => {
      const hostId = current.status === "connected" ? current.host?.hostId : undefined;
      const saved = record.hosts.find((candidate) => candidate.id === opened.host.id);
      if (!hostId || !saved || saved.hostId) return;
      saveRecord({
        ...record,
        hosts: record.hosts.map((host) => (host.id === saved.id ? { ...host, hostId } : host)),
      });
    });
  };

  const activate = (opened: OpenedHostSession) => {
    const active: ActiveHostSession = { ...opened, lifecycle: deps.startLifecycle(opened) };
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
  }: {
    discardUnsavedDrafts: boolean;
    signal?: AbortSignal | undefined;
  }) => {
    const current = session;
    if (current && !discardUnsavedDrafts) {
      try {
        await current.connection.saveDrafts();
      } catch (cause) {
        throw new DraftSaveBeforeSwitchError(
          `Some drafts for ${current.host.label} could not be saved: ${errorMessage(cause)} Stay on this host to keep them, or continue and lose the unsaved draft changes.`,
        );
      }
    }
    signal?.throwIfAborted();
    if (!current) return;
    session = null;
    stopHostIdWatch?.();
    stopHostIdWatch = null;
    current.lifecycle.stop();
    publish({ status: "switching", ...lists(), host: current.host });
    if (!discardUnsavedDrafts) {
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
    options: { discardUnsavedDrafts: boolean; signal?: AbortSignal | undefined },
  ): Promise<AddHostResult> => {
    await release(candidate.connection);
    deps.deleteHostStore(candidate.host.id);
    await closeSession(options);
    const moved: SavedHost = { ...known, ...reached };
    saveRecord({
      ...record,
      activeHostId: known.id,
      hosts: record.hosts.map((host) => (host.id === known.id ? moved : host)),
    });
    activate(openSession(moved, deps.openHostStore(known.id)));
    deps.feedback.show("success", `${known.label} is at a new address`, {
      description: reached.endpoint,
    });
    return { kind: "moved", host: moved };
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
    addHost: (address, options) =>
      serialize(async () => {
        const discardUnsavedDrafts = options?.discardUnsavedDrafts ?? false;
        let endpoint: string;
        try {
          endpoint = parseRemoteHostEndpoint(address, { requireHttps: false });
        } catch (cause) {
          throw new AddHostError(errorMessage(cause), null);
        }
        const existing = record.hosts.find((host) => host.endpoint === endpoint);
        if (existing) {
          if (session?.host.id === existing.id) {
            throw new AddHostError(
              "OpenDucktor is already connected to this host. Enter the address of another host.",
              null,
            );
          }
          await closeSession({ discardUnsavedDrafts, signal: options?.signal });
          saveRecord({ ...record, activeHostId: existing.id });
          activate(openSession(existing, deps.openHostStore(existing.id)));
          return { kind: "selected", host: existing };
        }
        const id = deps.createHostId();
        const candidateHost: SavedHost = {
          id,
          endpoint,
          label: options?.label?.trim() || defaultLabel(endpoint),
          shell: "web",
        };
        const candidate = openSession(candidateHost, deps.openHostStore(id));
        let connected: RemoteConnectionState;
        try {
          connected = await waitForConnected(candidate.remote, options?.signal);
        } catch (cause) {
          await release(candidate.connection);
          deps.deleteHostStore(id);
          throw cause;
        }
        const shell = connected.host?.shell ?? "web";
        const hostId = connected.host?.hostId;
        const known = hostId ? record.hosts.find((saved) => saved.hostId === hostId) : undefined;
        if (known)
          return moveHost(known, { endpoint, shell }, candidate, {
            discardUnsavedDrafts,
            signal: options?.signal,
          });
        const host: SavedHost = { ...candidateHost, shell };
        if (hostId) host.hostId = hostId;
        try {
          await closeSession({ discardUnsavedDrafts, signal: options?.signal });
        } catch (cause) {
          await release(candidate.connection);
          deps.deleteHostStore(id);
          throw cause;
        }
        saveRecord({ ...record, activeHostId: id, hosts: [...record.hosts, host] });
        activate({ ...candidate, host });
        return { kind: "added", host };
      }),
    selectHost: (hostId, options) =>
      serialize(async () => {
        const host = findHost(hostId);
        if (session?.host.id === hostId) return;
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
      if (session?.host.id === hostId) {
        session = { ...session, host: { ...session.host, label: trimmed } };
      }
      publishLists();
    },
    removeHost: (hostId) =>
      serialize(async () => {
        findHost(hostId);
        const wasActive = session?.host.id === hostId;
        // The user confirmed that unsent drafts of this host are deleted.
        if (wasActive) await closeSession({ discardUnsavedDrafts: true });
        deps.deleteHostStore(hostId);
        saveRecord({
          ...record,
          activeHostId: record.activeHostId === hostId ? null : record.activeHostId,
          hosts: record.hosts.filter((host) => host.id !== hostId),
        });
        if (session) publish({ status: "active", ...lists(), session });
        else publishIdle();
      }),
    removeDamagedHost(key) {
      const entry = record.damagedHosts.find((candidate) => candidate.key === key);
      if (!entry) throw new Error("This damaged host is already removed.");
      // A saved host with the same ID owns that store, so the store stays. The app never opens
      // the store of a damaged entry, so the store can go.
      if (entry.id !== null && !record.hosts.some((host) => host.id === entry.id)) {
        deps.deleteHostStore(entry.id);
      }
      saveRecord({
        ...record,
        damagedHosts: record.damagedHosts.filter((candidate) => candidate !== entry),
      });
      publishLists();
    },
    resetInvalidRecord() {
      if (state.status !== "invalid_record") return;
      // The app opens no host store before it can read the record, so each store can go.
      for (const hostId of state.hostIds) deps.deleteHostStore(hostId);
      deps.appStore.remove(state.invalid.key);
      owner.start();
    },
  };
  return owner;
};
