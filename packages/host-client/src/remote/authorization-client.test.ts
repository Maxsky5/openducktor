import { HOST_CHANNEL_SUBPROTOCOL, remoteConnectionRequestSchema } from "@openducktor/contracts";
import { expect, test } from "bun:test";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  type RemoteHostDescriptor,
} from "@openducktor/contracts";
import {
  createRemoteHostClient,
  type RemoteAuthorizationStore,
  type RemoteHttpResponse,
  type RemoteTransport,
  type SavedRemoteAuthorization,
} from "./index";
import {
  TEST_HOST_ID,
  TEST_CONNECTION_TOKEN,
  savedTestAuthorization,
} from "./test-support/authorization";
import { createFakeHostChannel } from "./test-support/host-channel";
import { openRemoteSocket } from "./socket";

const endpoint = "https://host.test";
const hello = {
  appVersion: "test",
  supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
  requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
  optionalCapabilities: [],
};
const encoder = new TextEncoder();
const fixture = () => {
  const channel = createFakeHostChannel({
    invoke: (command) => ({ result: command === "system_get_platform" ? "linux" : null }),
  });
  let saved: SavedRemoteAuthorization | null = null;
  let refuseSaved = false;
  let terminals = 0;
  const requests: {
    method: string;
    path: string;
    headers: Readonly<Record<string, string>>;
    body: { pairingCode?: string };
  }[] = [];
  const host: RemoteHostDescriptor = {
    shell: "web",
    hostId: TEST_HOST_ID,
    hostInstanceId: "run-1",
    appVersion: "test",
    accessPolicy: "pairing",
    protocols: [
      { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
    ],
  };
  const json = <Value>(value: Value, status = 200): RemoteHttpResponse => ({
    status,
    headers: {},
    body: (async function* () {
      if (status !== 204) yield encoder.encode(JSON.stringify(value));
    })(),
  });
  const store: RemoteAuthorizationStore = {
    read: async () => saved,
    save: async (value) => {
      saved = value;
    },
  };
  const transport: RemoteTransport = {
    async request(method, url, headers, signal, body) {
      const path = new URL(url).pathname;
      const input: { pairingCode?: string } =
        path === "/connections" && body
          ? remoteConnectionRequestSchema.parse(JSON.parse(body))
          : {};
      requests.push({ method, path, headers, body: input });
      if (path === "/") return json(host);
      if (path === "/connections") {
        if (headers.authorization && refuseSaved)
          return json(
            {
              status: "rejected",
              failure: {
                code: "authorization_rejected",
                message: "Access revoked.",
                nextAction: "Enter the host code.",
              },
            },
            401,
          );
        if (!headers.authorization && input.pairingCode !== "123456")
          return json(
            {
              status: "rejected",
              failure: {
                code: "authorization_required",
                message: "Code required.",
                nextAction: "Enter the host code.",
              },
            },
            401,
          );
        return json({
          status: "accepted",
          host,
          connectionId: crypto.randomUUID(),
          connectionToken: TEST_CONNECTION_TOKEN,
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          missingOptionalCapabilities: [],
          authorization: headers.authorization ? undefined : savedTestAuthorization(),
        });
      }
      return json(null, 204);
    },
    openSocket: (url, protocol, headers, signal, onFrame, onClose) => {
      if (protocol !== HOST_CHANNEL_SUBPROTOCOL) {
        terminals++;
        return Promise.reject(new Error("No terminal in this fixture."));
      }
      requests.push({ method: "GET", path: new URL(url).pathname, headers, body: {} });
      return openRemoteSocket(channel.createSocket, protocol, headers, signal, onFrame, onClose);
    },
  };
  const create = () =>
    createRemoteHostClient(endpoint, hello, transport, async () => {}, {
      store,
      clientKind: "browser",
    });
  return {
    store,
    transport,
    host,
    requests,
    terminals: () => terminals,
    create,
    saved: () => saved,
    refuseSaved: () => {
      refuseSaved = true;
    },
  };
};

test("code entry saves the grant before work and a new client restores saved access", async () => {
  const f = fixture();
  const first = f.create();
  const gate = Promise.withResolvers<void>();
  const writing = Promise.withResolvers<void>();
  const save = f.store.save;
  f.store.save = async (value) => {
    writing.resolve();
    await gate.promise;
    await save(value);
  };
  try {
    await expect(first.connect()).rejects.toMatchObject({
      failure: { code: "authorization_required" },
    });
    const connecting = first.connect({ pairingCode: "123456" });
    await writing.promise;
    expect(f.requests.some((request) => request.path === "/channel")).toBe(false);
    gate.resolve();
    await connecting;
    expect(first.readState().status).toBe("connected");
    expect(f.requests.find((request) => request.path === "/channel")?.headers.authorization).toBe(
      `Bearer ${TEST_CONNECTION_TOKEN}`,
    );
    await first.disconnect();
    const second = f.create();
    try {
      await second.connect();
      const negotiation = f.requests.filter((request) => request.path === "/connections").at(-1)!;
      expect(negotiation.headers.authorization).toBe(`Bearer ${f.saved()!.authorization.token}`);
      expect(negotiation.body.pairingCode).toBeUndefined();
    } finally {
      await second.disconnect();
    }
  } finally {
    gate.resolve();
    await first.disconnect();
  }
});

test("refused credentials stop being reused and a supplied code is submitted once", async () => {
  const f = fixture();
  await f.store.save({ version: 1, endpoint, authorization: savedTestAuthorization() });
  f.refuseSaved();
  const remote = f.create();
  try {
    await expect(remote.connect()).rejects.toMatchObject({
      failure: { code: "authorization_rejected" },
    });
    await remote.connect({ pairingCode: "123456" });
    expect(f.requests.filter((request) => request.body.pairingCode !== undefined)).toHaveLength(1);
    expect(f.saved()).not.toBeNull();
  } finally {
    await remote.disconnect();
  }
});

test.each(["read", "save"] as const)(
  "a device authorization %s failure keeps work locked",
  async (operation) => {
    const f = fixture();
    const remote = f.create();
    f.store[operation] = async () => {
      throw new Error("Device storage is full.");
    };
    try {
      await expect(remote.connect({ pairingCode: "123456" })).rejects.toMatchObject({
        failure: { code: "authorization_storage_failed" },
      });
      expect(remote.readState().status).toBe("failed");
      expect(f.requests.some((request) => request.path === "/channel")).toBe(false);
      if (operation === "save")
        expect(
          f.requests.some(
            (request) =>
              request.method === "DELETE" &&
              request.headers.authorization === `Bearer ${TEST_CONNECTION_TOKEN}`,
          ),
        ).toBe(true);
    } finally {
      await remote.disconnect();
    }
  },
);

test("a pending credential save blocks concurrent work and a failed save keeps it locked", async () => {
  const f = fixture();
  const writing = Promise.withResolvers<void>();
  const saved = Promise.withResolvers<void>();
  f.store.save = async () => {
    writing.resolve();
    await saved.promise;
  };
  const remote = f.create();
  const connecting = remote.connect({ pairingCode: "123456" }).catch((cause: unknown) => cause);
  const work = () =>
    Promise.allSettled([
      remote.client.setTheme("dark"),
      remote.client.systemGetPlatform(),
      remote.readStagedPreview("/preview", new AbortController().signal),
      remote.connectTerminal(
        new AbortController().signal,
        () => {},
        () => {},
      ),
    ]);
  try {
    await writing.promise;
    const pendingWork = work();
    const beforeSave = f.requests.slice();
    saved.reject(new Error("Device storage is full."));
    expect(await connecting).toMatchObject({
      failure: { code: "authorization_storage_failed" },
    });
    const pendingResults = await pendingWork;
    const laterResults = await work();
    expect(beforeSave.map(({ path }) => path)).toEqual(["/", "/connections"]);
    expect(pendingResults.map(({ status }) => status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
    ]);
    for (const result of laterResults)
      expect(result).toMatchObject({
        status: "rejected",
        reason: { failure: { code: "authorization_storage_failed" } },
      });
    expect(f.terminals()).toBe(0);
    expect(f.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /",
      "POST /connections",
      "DELETE /connections/current",
    ]);
  } finally {
    saved.reject(new Error("Test finished."));
    await remote.disconnect();
  }
});

test("disconnect during credential storage releases the private admission without exposing work", async () => {
  const f = fixture();
  const writing = Promise.withResolvers<void>();
  const saved = Promise.withResolvers<void>();
  f.store.save = async () => {
    writing.resolve();
    await saved.promise;
  };
  const remote = f.create();
  const connecting = remote.connect({ pairingCode: "123456" }).catch((cause: unknown) => cause);
  try {
    await writing.promise;
    const command = remote.client.setTheme("dark").catch((cause: unknown) => cause);
    const stopping = remote.disconnect();
    expect(remote.readState().status).toBe("idle");
    saved.resolve();
    await stopping;
    expect(await connecting).toBeInstanceOf(Error);
    expect(await command).toBeInstanceOf(Error);
    expect(f.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /",
      "POST /connections",
      "DELETE /connections/current",
    ]);
  } finally {
    saved.resolve();
    await remote.disconnect();
  }
});

test("legacy discovery refuses access before reading or sending saved proof", async () => {
  const f = fixture();
  f.host.accessPolicy = "network_reach";
  let reads = 0;
  f.store.read = async () => {
    reads++;
    return null;
  };
  const remote = f.create();
  try {
    await expect(remote.connect({ pairingCode: "123456" })).rejects.toMatchObject({
      failure: { code: "protocol_mismatch", updateSide: "host" },
    });
    expect(reads).toBe(0);
    expect(f.requests).toHaveLength(1);
  } finally {
    await remote.disconnect();
  }
});

test("canceling a pending approval releases its late admission without storing or exposing work", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const request = f.transport.request;
  f.transport.request = async (...args) => {
    const result = await request(...args);
    if (args[1].endsWith("/connections")) {
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  const remote = f.create();
  const abort = new AbortController();
  const connecting = remote
    .connect({ pairingCode: "123456", signal: abort.signal })
    .catch((cause) => cause);
  try {
    await entered.promise;
    abort.abort(new Error("Canceled"));
    gate.resolve();
    await connecting;
    expect(remote.readState().status).toBe("idle");
    expect(f.saved()).toBeNull();
    expect(f.requests.some((request) => request.path === "/channel")).toBe(false);
    expect(
      f.requests.some(
        (request) =>
          request.method === "DELETE" &&
          request.headers.authorization === `Bearer ${TEST_CONNECTION_TOKEN}`,
      ),
    ).toBe(true);
  } finally {
    gate.resolve();
    await remote.disconnect();
  }
});
