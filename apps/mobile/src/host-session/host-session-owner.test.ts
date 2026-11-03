import { afterEach, describe, expect, mock, test } from "bun:test";
import { TEST_HOST_ID, savedTestAuthorization } from "@openducktor/host-client/remote/test-support";
import {
  createComposerAttachment,
  createTextSegment,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { toAgentChatDraftStorageKey } from "@openducktor/frontend-core/drafts/agent-chat-draft-storage";
import type { AttachmentStager } from "@openducktor/frontend-core/platform/device-file";
import { SAVED_HOSTS_KEY, type SavedHost } from "../device-data/device-records";
import {
  createMemoryDeviceStore,
  createMemoryHostStores,
  createRecordingFeedback,
} from "../test-support/memory-device-store";
import { createSimulatedRemoteHost } from "../test-support/simulated-remote-host";
import {
  type ActiveHostSession,
  AddHostError,
  createHostSessionOwner,
  DraftSaveBeforeSwitchError,
  type HostSessionDependencies,
  type HostSessionOwner,
} from "./host-session-owner";
import {
  type AppActivity,
  type DeviceNetwork,
  startLifecycleController,
} from "./lifecycle-controller";

const owners: HostSessionOwner[] = [];

// Removing the active host releases its connection, so no test leaves an event stream open.
afterEach(async () => {
  for (const owner of owners.splice(0)) {
    const state = owner.getState();
    if (state.status === "active") await owner.removeHost(state.session.host.id);
  }
});

/** The default stager fails, as an upload to an unreachable host does. */
const failingStager: AttachmentStager = async (file) => {
  throw new Error(`${file.name} could not be uploaded.`);
};

const stubLifecycle: HostSessionDependencies["startLifecycle"] = () => ({
  deviceOnline: () => true,
  subscribeDeviceOnline: () => () => {},
  resuming: () => false,
  subscribeResuming: () => () => {},
  stop: () => {},
});

const setup = (
  initial?: Record<string, string>,
  {
    stageAttachment = failingStager,
    startLifecycle = stubLifecycle,
    hostId,
    pairingCode,
  }: {
    stageAttachment?: AttachmentStager;
    startLifecycle?: HostSessionDependencies["startLifecycle"];
    /** The stable host ID that the simulated host sends. */
    hostId?: string;
    pairingCode?: string;
  } = {},
) => {
  const hostOptions: NonNullable<Parameters<typeof createSimulatedRemoteHost>[0]> = {
    shell: "web",
  };
  if (hostId !== undefined) hostOptions.hostId = hostId;
  if (pairingCode !== undefined) hostOptions.pairingCode = pairingCode;
  const host = createSimulatedRemoteHost(hostOptions);
  const staged: string[] = [];
  const appStore = createMemoryDeviceStore(initial);
  const hostStores = createMemoryHostStores();
  let nextId = 0;
  const dependencies: HostSessionDependencies = {
    appStore,
    openHostStore: hostStores.open,
    deleteHostStore: hostStores.remove,
    openAuthorizationStore: hostStores.authorization,
    createTransport: () => host.transport,
    createHostId: () => `host-${++nextId}`,
    appVersion: "mobile-test",
    feedback: createRecordingFeedback(),
    createAttachmentStager: () => async (file) => {
      staged.push(file.name);
      return stageAttachment(file);
    },
    startLifecycle,
  };
  const owner = createHostSessionOwner(dependencies);
  owners.push(owner);
  return { host, appStore, hostStores, owner, staged, dependencies };
};

const activeSession = (owner: HostSessionOwner): ActiveHostSession => {
  const state = owner.getState();
  if (state.status !== "active") throw new Error(`The owner is ${state.status}, not active.`);
  return state.session;
};

const CHAT_DRAFT = { workspaceId: "workspace-1", workspaceSessionId: "chat-1" };

/** An unsent chat message. With `file`, it holds a device file that the host has not staged. */
const seedChatDraft = (session: ActiveHostSession, file?: string) =>
  session.connection.drafts.chat.set(CHAT_DRAFT, null, {
    segments: [createTextSegment("Unsent message")],
    attachments: file
      ? [
          createComposerAttachment({
            name: file,
            kind: "pdf",
            file: { name: file, type: "application/pdf", size: 12 },
          }),
        ]
      : [],
  });

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

const waitForStatus = (
  session: {
    remote: {
      remote: { subscribeState: (listener: (state: { status: string }) => void) => () => void };
    };
  },
  status: string,
) =>
  new Promise<void>((resolve) => {
    const stop = session.remote.remote.subscribeState((state) => {
      if (state.status !== status) return;
      queueMicrotask(() => stop());
      resolve();
    });
  });

/** Resolves when the remote client is connected again after `generation`. */
const waitForReconnect = (session: ActiveHostSession, generation: number) =>
  new Promise<void>((resolve) => {
    const stop = session.remote.remote.subscribeState((state) => {
      if (state.status !== "connected" || state.generation <= generation) return;
      queueMicrotask(() => stop());
      resolve();
    });
  });

/** A device source that a test changes by hand. */
const deviceSource = <Value>(initial: Value) => {
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
    refresh: () => {},
    emit(next: Value) {
      value = next;
      for (const listener of listeners) listener(next);
    },
  };
};

const savedRecord = (activeHostId: string | null, endpoints: string[]) =>
  JSON.stringify({
    activeHostId,
    hosts: endpoints.map((endpoint, index) => ({
      id: `saved-${index + 1}`,
      endpoint,
      label: `Host ${index + 1}`,
      shell: "electron",
    })),
  });

const setupDraftLossPairing = async (kind: "added" | "selected" | "moved") => {
  const previousEndpoint = "http://100.64.0.7:14328";
  const endpoint = "http://100.64.0.8:14328";
  const endpoints = kind === "selected" ? [previousEndpoint, endpoint] : [previousEndpoint];
  const initial = { [SAVED_HOSTS_KEY]: savedRecord("saved-1", endpoints) };
  const f =
    kind === "moved"
      ? setup(initial, { hostId: TEST_HOST_ID, pairingCode: "123456" })
      : setup(initial, { pairingCode: "123456" });
  await f.hostStores.authorization("saved-1").save({
    version: 1,
    endpoint: previousEndpoint,
    authorization: savedTestAuthorization(),
  });
  f.owner.start();
  const previous = activeSession(f.owner);
  await waitForStatus(previous, "connected");
  seedChatDraft(previous, "notes.pdf");
  return { ...f, previous, endpoint };
};

const VALID_ENTRY: SavedHost = {
  id: "saved-1",
  endpoint: "http://100.64.0.7:14328",
  label: "Studio Mac",
  shell: "electron",
};
/** An entry whose address the endpoint rules of this release reject. */
const DAMAGED_ENTRY = {
  id: "saved-9",
  endpoint: "http://localhost:14328",
  label: "Old Mac",
  shell: "electron",
};

const storedHosts = (appStore: { getString(key: string): string | undefined }) =>
  JSON.parse(appStore.getString(SAVED_HOSTS_KEY) ?? "null");

describe("host session owner", () => {
  test("saves a host only after the connection is admitted and synchronized", async () => {
    const { owner, appStore } = setup();
    owner.start();
    expect(owner.getState().status).toBe("no_host");

    const result = await owner.addHost("  http://100.64.0.7:14328/ ");

    expect(result).toEqual({
      kind: "added",
      host: {
        id: "host-1",
        endpoint: "http://100.64.0.7:14328",
        label: "100.64.0.7",
        shell: "web",
        hostId: "20000000-0000-4000-8000-000000000001",
      },
    });
    const state = owner.getState();
    expect(state.status).toBe("active");
    if (state.status === "active") {
      expect(state.session.remote.remote.readState().status).toBe("connected");
    }
    expect(JSON.parse(appStore.getString(SAVED_HOSTS_KEY) ?? "null")).toEqual({
      activeHostId: "host-1",
      hosts: [result.host],
    });
  });

  test("saves the name that the user gives a new host", async () => {
    const { owner } = setup();
    owner.start();
    const result = await owner.addHost("http://100.64.0.7:14328", { label: "  Studio Mac " });
    expect(result.host.label).toBe("Studio Mac");
    const blank = await owner.addHost("http://100.64.0.8:14328", { label: "   " });
    expect(blank.host.label).toBe("100.64.0.8");
  });

  test("keeps the input rule message for an invalid address and saves nothing", async () => {
    const { owner, appStore } = setup();
    owner.start();
    const failure = await owner.addHost("http://localhost:3000").catch((cause) => cause);
    expect(failure).toBeInstanceOf(AddHostError);
    expect(String(failure.message)).toContain("other devices can reach");
    expect(appStore.getString(SAVED_HOSTS_KEY)).toBeUndefined();
  });

  test("deletes the candidate storage when the host cannot be reached", async () => {
    const { owner, host, hostStores, appStore } = setup();
    owner.start();
    host.setAdmission({ kind: "unreachable" });
    const failure = await owner.addHost("http://100.64.0.7:14328").catch((cause) => cause);
    expect(failure).toBeInstanceOf(AddHostError);
    expect(failure.failure?.code).toBe("unavailable");
    expect(hostStores.deleted).toEqual(["host-1"]);
    expect(appStore.getString(SAVED_HOSTS_KEY)).toBeUndefined();
    expect(owner.getState().status).toBe("no_host");
  });

  test("shows the host reason when remote control is disabled", async () => {
    const { owner, host } = setup();
    owner.start();
    host.setAdmission({
      kind: "refuse",
      status: 503,
      failure: {
        code: "remote_disabled",
        message: "Remote control is off on this host.",
        nextAction: "Enable Remote control in the host settings.",
      },
    });
    const failure = await owner.addHost("http://100.64.0.7:14328").catch((cause) => cause);
    expect(failure.message).toBe(
      "Remote control is off on this host. Enable Remote control in the host settings.",
    );
  });

  test("adds a host without the unsaved drafts of the current host only after consent", async () => {
    const { owner, staged } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]),
    });
    owner.start();
    const first = owner.getState();
    seedChatDraft(activeSession(owner), "notes.pdf");

    const failure = await owner.addHost("http://100.64.0.8:14328").catch((cause) => cause);
    expect(failure).toBeInstanceOf(DraftSaveBeforeSwitchError);
    expect(String(failure.message)).toContain("notes.pdf could not be uploaded.");
    expect(owner.getState()).toBe(first);

    const result = await owner.addHost("http://100.64.0.8:14328", { discardUnsavedDrafts: true });
    expect(result.kind).toBe("added");
    expect(activeSession(owner).host.id).toBe(result.host.id);
    // The discarded draft does not try its upload again.
    expect(staged).toEqual(["notes.pdf"]);
  });

  test.each(["added", "selected", "moved"] as const)(
    "keeps one-use approval through draft-loss confirmation for a %s host",
    async (kind) => {
      const f = await setupDraftLossPairing(kind);
      const confirmDraftLoss = mock(async (cause: DraftSaveBeforeSwitchError) => {
        expect(cause).toBeInstanceOf(DraftSaveBeforeSwitchError);
        expect(activeSession(f.owner)).toBe(f.previous);
        return true;
      });
      const result = await f.owner.addHost(f.endpoint, {
        pairingCode: "123456",
        confirmDraftLoss,
      });
      expect(result.kind).toBe(kind);
      expect(activeSession(f.owner).host.endpoint).toBe(f.endpoint);
      expect(confirmDraftLoss).toHaveBeenCalledTimes(1);
      expect((await f.hostStores.authorization(result.host.id).read(f.endpoint))?.endpoint).toBe(
        f.endpoint,
      );
      expect(f.staged).toEqual(["notes.pdf"]);
    },
  );

  test.each(["decline", "abort"] as const)(
    "%s during draft-loss confirmation keeps the current host and cleans the candidate",
    async (action) => {
      const f = await setupDraftLossPairing("added");
      const entered = deferred<void>();
      const choice = deferred<boolean>();
      const cancellation = new AbortController();
      const operation = f.owner
        .addHost(f.endpoint, {
          pairingCode: "123456",
          signal: cancellation.signal,
          confirmDraftLoss: async () => {
            entered.resolve();
            return choice.promise;
          },
        })
        .catch((cause: unknown) => cause);
      try {
        const asked = await Promise.race([
          entered.promise.then(() => true),
          operation.then(() => false),
        ]);
        expect(asked).toBe(true);
        expect(activeSession(f.owner)).toBe(f.previous);
        if (action === "decline") choice.resolve(false);
        else cancellation.abort(new Error("The user closed Add Host."));
        const failure = await operation;
        if (action === "decline") expect(failure).toBeInstanceOf(DraftSaveBeforeSwitchError);
        else expect(failure).toBe(cancellation.signal.reason);
        expect(activeSession(f.owner)).toBe(f.previous);
        expect(f.previous.remote.remote.readState().status).toBe("connected");
        expect(await f.hostStores.authorization("host-1").read(f.endpoint)).toBeNull();
        expect(f.hostStores.deleted).toEqual(["host-1"]);
        choice.resolve(true);
        await Promise.resolve();
        expect(activeSession(f.owner)).toBe(f.previous);
      } finally {
        choice.resolve(false);
        await operation;
      }
    },
  );

  test("a switch writes the drafts of the old host to its device store", async () => {
    const { owner, hostStores } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", [
        "http://100.64.0.7:14328",
        "http://100.64.0.8:14328",
      ]),
    });
    owner.start();
    seedChatDraft(activeSession(owner));

    await owner.selectHost("saved-2");

    const stored = hostStores.stores
      .get("saved-1")
      ?.getString(toAgentChatDraftStorageKey(CHAT_DRAFT));
    expect(stored).toContain("Unsent message");
  });

  test("removing the active host uploads no attachment of its drafts", async () => {
    const { owner, staged } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]),
    });
    owner.start();
    seedChatDraft(activeSession(owner), "notes.pdf");

    await owner.removeHost("saved-1");

    expect(staged).toEqual([]);
    expect(owner.getState().status).toBe("no_host");
  });

  test("a canceled add before admission deletes the candidate and keeps the current host", async () => {
    const { owner, hostStores, appStore } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]),
    });
    owner.start();
    const first = owner.getState();
    const record = appStore.getString(SAVED_HOSTS_KEY);
    const controller = new AbortController();

    const added = owner.addHost("http://100.64.0.8:14328", { signal: controller.signal });
    controller.abort(new Error("The user canceled the connection."));
    const failure = await added.catch((cause) => cause);

    expect(failure.message).toBe("The user canceled the connection.");
    expect(hostStores.deleted).toEqual(["host-1"]);
    expect(appStore.getString(SAVED_HOSTS_KEY)).toBe(record);
    expect(owner.getState()).toBe(first);
  });

  test("a cancel during the draft save of the current host keeps that host", async () => {
    const upload = deferred<string>();
    const { owner, hostStores, appStore, staged } = setup(
      { [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]) },
      { stageAttachment: () => upload.promise },
    );
    owner.start();
    const first = owner.getState();
    await waitForStatus(activeSession(owner), "connected");
    const record = appStore.getString(SAVED_HOSTS_KEY);
    seedChatDraft(activeSession(owner), "notes.pdf");
    const controller = new AbortController();

    const added = owner.addHost("http://100.64.0.8:14328", { signal: controller.signal });
    while (staged.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(new Error("The user closed Add Host."));
    upload.resolve("/host/staged/notes.pdf");
    const failure = await added.catch((cause) => cause);

    expect(failure.message).toBe("The user closed Add Host.");
    expect(hostStores.deleted).toEqual(["host-1"]);
    expect(appStore.getString(SAVED_HOSTS_KEY)).toBe(record);
    expect(owner.getState()).toBe(first);
  });

  test("the address of the active host shows why nothing changes", async () => {
    const { owner } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]),
    });
    owner.start();
    const first = owner.getState();
    const failure = await owner.addHost("http://100.64.0.7:14328/").catch((cause) => cause);
    expect(failure).toBeInstanceOf(AddHostError);
    expect(String(failure.message)).toContain("already connected to this host");
    expect(owner.getState()).toBe(first);
  });

  test("selects the saved host instead of adding a duplicate", async () => {
    const { owner } = setup({
      [SAVED_HOSTS_KEY]: savedRecord(null, ["http://100.64.0.7:14328"]),
    });
    owner.start();
    const result = await owner.addHost("http://100.64.0.7:14328/");
    expect(result.kind).toBe("selected");
    expect(result.host.id).toBe("saved-1");
    expect(owner.getState().status).toBe("active");
  });

  test("saves the stable ID of a new host", async () => {
    const { owner, appStore } = setup(undefined, {
      hostId: "20000000-0000-4000-8000-000000000001",
    });
    owner.start();
    const result = await owner.addHost("http://100.64.0.7:14328");
    expect(result.host.hostId).toBe("20000000-0000-4000-8000-000000000001");
    expect(storedHosts(appStore).hosts[0].hostId).toBe("20000000-0000-4000-8000-000000000001");
  });

  test("moves a saved host to the new address of the same host and keeps its name and store", async () => {
    const { owner, appStore, hostStores } = setup(
      {
        [SAVED_HOSTS_KEY]: JSON.stringify({
          activeHostId: null,
          hosts: [{ ...VALID_ENTRY, hostId: "20000000-0000-4000-8000-000000000001" }],
        }),
      },
      { hostId: "20000000-0000-4000-8000-000000000001" },
    );
    hostStores.open("saved-1").set("draft", "kept");
    owner.start();
    const result = await owner.addHost("http://192.168.1.9:14328");
    expect(result).toEqual({
      kind: "moved",
      host: {
        ...VALID_ENTRY,
        endpoint: "http://192.168.1.9:14328",
        shell: "web",
        hostId: "20000000-0000-4000-8000-000000000001",
      },
    });
    expect(storedHosts(appStore)).toEqual({ activeHostId: "saved-1", hosts: [result.host] });
    expect(activeSession(owner).host.id).toBe("saved-1");
    expect(hostStores.open("saved-1").getString("draft")).toBe("kept");
    // The connection to the new address used a temporary store, which the move deletes.
    expect(hostStores.deleted).toEqual(["host-1"]);
  });

  test("a saved host from before host IDs gets the ID of its host when it connects", async () => {
    const { owner, appStore } = setup(
      { [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]) },
      { hostId: "20000000-0000-4000-8000-000000000001" },
    );
    owner.start();
    await waitForStatus(activeSession(owner), "connected");
    expect(storedHosts(appStore).hosts[0].hostId).toBe("20000000-0000-4000-8000-000000000001");
  });

  test("restores the last active host at start and replaces the connection on a switch", async () => {
    const { owner, host } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", [
        "http://100.64.0.7:14328",
        "http://100.64.0.8:14328",
      ]),
    });
    owner.start();
    const first = owner.getState();
    if (first.status !== "active") throw new Error("The first host did not start.");
    expect(first.session.host.id).toBe("saved-1");
    await waitForStatus(first.session, "connected");

    await owner.selectHost("saved-2");

    const second = owner.getState();
    if (second.status !== "active") throw new Error("The second host did not start.");
    expect(second.session.host.id).toBe("saved-2");
    expect(second.session.sessionKey).not.toBe(first.session.sessionKey);
    expect(first.session.remote.remote.readState().status).toBe("idle");
    expect(host.released.length).toBeGreaterThan(0);
  });

  test("selecting the active host again keeps the connection", async () => {
    const { owner } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]),
    });
    owner.start();
    const before = owner.getState();
    await owner.selectHost("saved-1");
    expect(owner.getState()).toBe(before);
  });

  test("removing the active host deletes its local data and its record", async () => {
    const { owner, hostStores, appStore } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]),
    });
    owner.start();
    await owner.removeHost("saved-1");
    expect(hostStores.deleted).toEqual(["saved-1"]);
    expect(owner.getState()).toEqual({ status: "no_host", hosts: [], damagedHosts: [] });
    expect(JSON.parse(appStore.getString(SAVED_HOSTS_KEY) ?? "null")).toEqual({
      activeHostId: null,
      hosts: [],
    });
  });

  test("removing another host keeps the active session", async () => {
    const { owner, hostStores, appStore } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", [
        "http://100.64.0.7:14328",
        "http://100.64.0.8:14328",
      ]),
    });
    owner.start();
    const session = activeSession(owner);
    await owner.removeHost("saved-2");
    expect(activeSession(owner)).toBe(session);
    expect(hostStores.deleted).toEqual(["saved-2"]);
    const saved = JSON.parse(appStore.getString(SAVED_HOSTS_KEY) ?? "null");
    expect(saved.hosts.map((host: { id: string }) => host.id)).toEqual(["saved-1"]);
  });

  test("host transitions that start together run one after the other", async () => {
    const { owner, hostStores } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", [
        "http://100.64.0.7:14328",
        "http://100.64.0.8:14328",
      ]),
    });
    owner.start();
    // The removal waits for the switch, so it removes the host that became active.
    await Promise.all([owner.selectHost("saved-2"), owner.removeHost("saved-2")]);
    expect(hostStores.deleted).toEqual(["saved-2"]);
    const state = owner.getState();
    expect(state.status).toBe("no_host");
    expect(state.status === "no_host" ? state.hosts.map((host) => host.id) : null).toEqual([
      "saved-1",
    ]);
  });

  test("a link change replaces the event stream of the active host at once", async () => {
    const activity = deviceSource<AppActivity>("foreground");
    const network = deviceSource<DeviceNetwork>({ isConnected: true, type: "WIFI" });
    const { owner, host } = setup(
      { [SAVED_HOSTS_KEY]: savedRecord("saved-1", ["http://100.64.0.7:14328"]) },
      {
        startLifecycle: (session) =>
          startLifecycleController(
            activity,
            network,
            {
              remote: session.remote.remote,
              saveDrafts: () => session.connection.saveDrafts(),
              onDraftSaveFailure: () => {},
            },
            60_000,
          ),
      },
    );
    owner.start();
    const session = activeSession(owner);
    await waitForStatus(session, "connected");
    expect(host.openStreamCount()).toBe(1);
    const { generation } = session.remote.remote.readState();

    network.emit({ isConnected: true, type: "CELLULAR" });
    await waitForReconnect(session, generation);

    // The old admission is released, and only the new stream stays open.
    expect(host.released).toHaveLength(1);
    expect(host.openStreamCount()).toBe(1);
  });

  test("reports a saved host record that is not JSON and resets only that record", async () => {
    const { owner, appStore, hostStores } = setup({
      [SAVED_HOSTS_KEY]: "{not json",
      other: "kept",
    });
    owner.start();
    const state = owner.getState();
    expect(state.status).toBe("invalid_record");
    await owner.resetInvalidRecord();
    expect(owner.getState()).toEqual({ status: "no_host", hosts: [], damagedHosts: [] });
    expect(appStore.getString(SAVED_HOSTS_KEY)).toBeUndefined();
    expect(appStore.getString("other")).toBe("kept");
    expect(hostStores.deleted).toEqual([]);
  });

  test("the reset of a record with no host list deletes the stores of the IDs that it names", async () => {
    const { owner, appStore, hostStores } = setup({
      [SAVED_HOSTS_KEY]: JSON.stringify({
        activeHostId: "saved-1",
        hosts: { first: VALID_ENTRY, second: DAMAGED_ENTRY },
      }),
    });
    owner.start();
    const state = owner.getState();
    expect(state.status === "invalid_record" ? state.hostIds : null).toEqual([
      "saved-1",
      "saved-9",
    ]);
    // The app opens no store of a host in a record that it cannot read.
    expect([...hostStores.stores.keys()]).toEqual([]);

    await owner.resetInvalidRecord();

    expect(hostStores.deleted).toEqual(["saved-1", "saved-9"]);
    expect(appStore.getString(SAVED_HOSTS_KEY)).toBeUndefined();
    expect(owner.getState()).toEqual({ status: "no_host", hosts: [], damagedHosts: [] });
  });

  test("starts with the valid hosts and lists a damaged entry without opening it", () => {
    const { owner, hostStores } = setup({
      [SAVED_HOSTS_KEY]: JSON.stringify({
        activeHostId: "saved-1",
        hosts: [DAMAGED_ENTRY, VALID_ENTRY],
      }),
    });
    owner.start();
    const state = owner.getState();
    if (state.status !== "active") throw new Error(`The owner is ${state.status}, not active.`);
    expect(state.session.host).toEqual(VALID_ENTRY);
    expect(state.hosts).toEqual([VALID_ENTRY]);
    expect(state.damagedHosts).toEqual([
      {
        key: "damaged-0",
        raw: DAMAGED_ENTRY,
        id: "saved-9",
        label: "Old Mac",
        endpoint: "http://localhost:14328",
        reason: "This version of the app does not accept its address.",
      },
    ]);
    expect([...hostStores.stores.keys()]).toEqual(["saved-1"]);
  });

  test("an active ID of a damaged entry starts with no active host", () => {
    const { owner, hostStores } = setup({
      [SAVED_HOSTS_KEY]: JSON.stringify({
        activeHostId: "saved-9",
        hosts: [VALID_ENTRY, DAMAGED_ENTRY],
      }),
    });
    owner.start();
    const state = owner.getState();
    expect(state.status).toBe("no_host");
    expect(state.status === "no_host" ? state.damagedHosts.map((entry) => entry.id) : null).toEqual(
      ["saved-9"],
    );
    expect([...hostStores.stores.keys()]).toEqual([]);
  });

  test("a change to the valid hosts writes each damaged entry back unchanged", async () => {
    const { owner, appStore } = setup({
      [SAVED_HOSTS_KEY]: JSON.stringify({
        activeHostId: null,
        hosts: [DAMAGED_ENTRY, VALID_ENTRY],
      }),
    });
    owner.start();
    owner.renameHost("saved-1", "Desk Mac");
    const result = await owner.addHost("http://100.64.0.8:14328");

    expect(storedHosts(appStore)).toEqual({
      activeHostId: result.host.id,
      hosts: [{ ...VALID_ENTRY, label: "Desk Mac" }, result.host, DAMAGED_ENTRY],
    });
  });

  test("removing a damaged entry deletes its store and keeps the other hosts", async () => {
    const { owner, appStore, hostStores } = setup({
      [SAVED_HOSTS_KEY]: JSON.stringify({
        activeHostId: "saved-1",
        hosts: [VALID_ENTRY, DAMAGED_ENTRY, { label: "No ID" }],
      }),
    });
    owner.start();
    const session = activeSession(owner);

    await owner.removeDamagedHost("damaged-1");
    await owner.removeDamagedHost("damaged-2");

    expect(hostStores.deleted).toEqual(["saved-9"]);
    expect(storedHosts(appStore)).toEqual({ activeHostId: "saved-1", hosts: [VALID_ENTRY] });
    const state = owner.getState();
    expect(state.status === "active" ? state.damagedHosts : null).toEqual([]);
    expect(activeSession(owner)).toBe(session);
    expect(owner.removeDamagedHost("damaged-1")).rejects.toThrow(
      "This damaged host is already removed.",
    );
  });

  test("removing a damaged entry keeps the store of a saved host with the same ID", async () => {
    const { owner, hostStores } = setup({
      [SAVED_HOSTS_KEY]: JSON.stringify({
        activeHostId: null,
        hosts: [VALID_ENTRY, { ...VALID_ENTRY, shell: "mobile" }],
      }),
    });
    owner.start();
    await owner.removeDamagedHost("damaged-1");
    expect(hostStores.deleted).toEqual([]);
    expect(owner.getState()).toEqual({ status: "no_host", hosts: [VALID_ENTRY], damagedHosts: [] });
  });

  test("renaming another host shows the new name while a host is active", () => {
    const { owner } = setup({
      [SAVED_HOSTS_KEY]: savedRecord("saved-1", [
        "http://100.64.0.7:14328",
        "http://100.64.0.8:14328",
      ]),
    });
    owner.start();
    const session = activeSession(owner);
    owner.renameHost("saved-2", "Desk Mac");
    const state = owner.getState();
    expect(state.status === "active" ? state.hosts.map((host) => host.label) : null).toEqual([
      "Host 1",
      "Desk Mac",
    ]);
    expect(activeSession(owner)).toBe(session);
  });

  test("renames a saved host", () => {
    const { owner } = setup({
      [SAVED_HOSTS_KEY]: savedRecord(null, ["http://100.64.0.7:14328"]),
    });
    owner.start();
    owner.renameHost("saved-1", "  Studio Mac ");
    expect(owner.getState()).toEqual({
      status: "no_host",
      hosts: [
        {
          id: "saved-1",
          endpoint: "http://100.64.0.7:14328",
          label: "Studio Mac",
          shell: "electron",
        },
      ],
      damagedHosts: [],
    });
    expect(() => owner.renameHost("saved-1", " ")).toThrow("Enter a host name.");
  });
});

test.each(["new", "existing", "moved"] as const)(
  "cancel after recovery does not select the %s target",
  async (kind) => {
    const endpoints =
      kind === "existing"
        ? ["http://100.64.0.7:14328", "http://100.64.0.8:14328"]
        : ["http://100.64.0.7:14328"];
    const f = setup(
      { [SAVED_HOSTS_KEY]: savedRecord("saved-1", endpoints) },
      kind === "moved" ? { hostId: "20000000-0000-4000-8000-000000000001" } : {},
    );
    f.owner.start();
    await waitForStatus(activeSession(f.owner), "connected");
    const entered = deferred<void>();
    const gate = deferred<void>();
    if (kind === "moved") {
      const remove = f.dependencies.deleteHostStore;
      f.dependencies.deleteHostStore = async (id) => {
        if (id === "host-1") {
          entered.resolve();
          await gate.promise;
        }
        await remove(id);
      };
    } else {
      const request = f.host.transport.request;
      let held = false;
      f.host.transport.request = async (...args) => {
        if (args[0] === "DELETE" && !held) {
          held = true;
          entered.resolve();
          await gate.promise;
        }
        return request(...args);
      };
    }
    const abort = new AbortController();
    const adding = f.owner
      .addHost("http://100.64.0.8:14328", { signal: abort.signal })
      .catch((cause) => cause);
    await entered.promise;
    abort.abort(new Error("Canceled after recovery"));
    gate.resolve();
    const result = await adding;
    expect(result).toBeInstanceOf(Error);
    expect(storedHosts(f.appStore).activeHostId).toBe("saved-1");
    expect(f.owner.getState().status).not.toBe("active");
  },
);

test("failed credential deletion keeps the saved host and leaves a usable picker", async () => {
  const endpoint = "http://100.64.0.7:14328";
  const f = setup({ [SAVED_HOSTS_KEY]: savedRecord("saved-1", [endpoint]) });
  f.owner.start();
  await waitForStatus(activeSession(f.owner), "connected");
  const remove = f.dependencies.deleteHostStore;
  f.dependencies.deleteHostStore = async () => {
    throw new Error("Secure storage is unavailable.");
  };
  await expect(f.owner.removeHost("saved-1")).rejects.toThrow("Secure storage is unavailable.");
  expect(storedHosts(f.appStore).hosts).toHaveLength(1);
  expect(f.owner.getState().status).toBe("no_host");
  expect(await f.hostStores.authorization("saved-1").read(endpoint)).not.toBeNull();
  f.dependencies.deleteHostStore = remove;
  await f.owner.removeHost("saved-1");
  expect(storedHosts(f.appStore).hosts).toEqual([]);
  expect(await f.hostStores.authorization("saved-1").read(endpoint)).toBeNull();
});
