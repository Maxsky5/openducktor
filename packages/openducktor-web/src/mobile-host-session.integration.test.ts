import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Stream } from "effect";
import type { RemoteHttpResponse, RemoteTransport } from "@openducktor/host-client/remote";
import { remoteError } from "@openducktor/host-client/remote";
import { openRemoteSocket } from "@openducktor/host-client/remote/socket";
import { HOST_CHANNEL_SUBPROTOCOL } from "@openducktor/contracts";
import { createHostSessionOwner } from "../../../apps/mobile/src/host-session/host-session-owner";
import {
  createMemoryDeviceStore,
  createMemoryHostStores,
  createRecordingFeedback,
} from "../../../apps/mobile/src/test-support/memory-device-store";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { workspaceListQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import {
  gitFixtureEnv,
  initGitRepository,
} from "../../host/src/test-support/git-repository-fixture";
import { createDefaultGlobalConfig } from "../../host/src/config/global-config";
import type { WebLogger } from "./logger";
import { startTypescriptHostBackend } from "./typescript-host-backend";

const logger: WebLogger = {
  error: (message) => Effect.sync(() => console.error(message)),
  info: () => Effect.void,
  success: () => Effect.void,
};

// The remote endpoint must not use a loopback name, so the test publishes a test hostname and
// the transport sends each request to the loopback listener. The host accepts loopback Host headers.
const PUBLIC_HOSTNAME = "odt-mobile-host.test";

const createLoopbackTransport = (port: number): RemoteTransport => {
  const toLoopback = (url: string) => {
    const target = new URL(url);
    if (target.hostname !== PUBLIC_HOSTNAME) throw new Error(`Unexpected request target ${url}.`);
    target.hostname = "127.0.0.1";
    target.port = String(port);
    return target.href;
  };
  return {
    async request(method, url, headers, signal, body) {
      const init: RequestInit = { method, headers, signal, redirect: "manual" };
      if (body !== undefined) init.body = body;
      const response = await fetch(toLoopback(url), init);
      const reader = response.body?.getReader();
      const result: RemoteHttpResponse = {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: (async function* () {
          if (!reader) return;
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) return;
              yield next.value;
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        })(),
      };
      return result;
    },
    openSocket: async (url, protocol, headers, signal, onFrame, onClose) => {
      if (protocol !== HOST_CHANNEL_SUBPROTOCOL)
        throw remoteError(
          "function_unavailable",
          "This fixture does not open terminals.",
          "Use the terminal tests.",
        );
      return openRemoteSocket(
        (protocols) => new WebSocket(toLoopback(url), protocols),
        protocol,
        headers,
        signal,
        onFrame,
        onClose,
      );
    },
  };
};

test(
  "the mobile host session connects to a real host, runs work, reconnects, and removes the host",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mobile-host-"));
    try {
      // The client flow needs a real host with saved settings and no agent runtimes enabled.
      const configDir = join(root, "config");
      await mkdir(configDir);
      await writeFile(join(configDir, "config.json"), JSON.stringify(createDefaultGlobalConfig()));
      const backend = await startTypescriptHostBackend({
        port: 0,
        host: "127.0.0.1",
        frontendOrigin: "http://127.0.0.1:1420",
        appToken: "mobile-fixture-app-token",
        controlToken: "mobile-fixture-control-token",
        configDirScope: "test",
        // Use an empty zsh profile so host startup does not depend on the developer's shell setup.
        processEnv: { ...gitFixtureEnv, ZDOTDIR: root, OPENDUCKTOR_CONFIG_DIR: configDir },
        mcpBridgeDiscoveryMode: "production",
        runtimeDistribution: { mode: "source", workspaceRoot: process.cwd() },
        deferRemoteStartup: true,
        logger,
        onBackgroundFailure: (cause) => console.error("Host background failure", cause),
      });

      const waitForConnectedClients = async (expected: number) => {
        const reported = await backend.remoteAccess.states.pipe(
          Stream.filter((state) => state.connectedClients === expected),
          Stream.runHead,
          Effect.timeout("8 seconds"),
          Effect.runPromise,
        );
        assert.ok(
          Option.isSome(reported),
          `The host did not report ${expected} connected clients.`,
        );
      };
      try {
        const enabled = await Effect.runPromise(
          backend.remoteAccess.enable({
            listenHost: "127.0.0.1",
            // A public host address needs a fixed port. The remote handler shares the backend listener.
            listenPort: backend.port,
            publicEndpoint: `http://${PUBLIC_HOSTNAME}:${backend.port}`,
          }),
        );
        assert.equal(enabled.status, "available");
        const configuration = enabled.configuration;
        assert.ok(configuration, "Remote control returned no configuration.");
        const endpoint = new URL(configuration.publicEndpoint);
        const port = Number(endpoint.port);
        assert.ok(port > 0, "Remote control published no port.");

        const appStore = createMemoryDeviceStore();
        const hostStores = createMemoryHostStores();
        const owner = createHostSessionOwner({
          appStore,
          openHostStore: hostStores.open,
          deleteHostStore: hostStores.remove,
          openAuthorizationStore: hostStores.authorization,
          createTransport: () => createLoopbackTransport(port),
          createHostId: () => "real-host",
          appVersion: "mobile-integration",
          feedback: createRecordingFeedback(),
          createAttachmentStager: () => async () => {
            throw new Error("No attachment in this fixture.");
          },
          startLifecycle: () => ({
            deviceOnline: () => true,
            subscribeDeviceOnline: () => () => {},
            resuming: () => false,
            subscribeResuming: () => () => {},
            stop: () => {},
          }),
          createDemoSession: () => {
            throw new Error("No demo in this fixture.");
          },
        });
        owner.start();
        try {
          // Discovery, negotiation, the event stream, and the first synchronization use the real host.
          const { pairing } = await Effect.runPromise(backend.remoteAccess.startPairing());
          assert.ok(pairing, "Remote control returned no pairing code.");
          const added = await owner.addHost(endpoint.href, { pairingCode: pairing.code });
          assert.equal(added.kind, "added");
          assert.equal(added.host.shell, "web");
          const state = owner.getState();
          assert.equal(state.status, "active");
          if (state.status !== "active" || state.session.kind !== "remote")
            throw new Error("The host did not become active.");
          const { connection, remote } = state.session;
          assert.equal(remote.remote.readState().status, "connected");
          await waitForConnectedClients(1);

          // A workspace and a task round-trip through the same query caches that the app reads.
          const repoPath = join(root, "repo");
          await mkdir(repoPath);
          initGitRepository(repoPath, "main");
          const setup = await connection.host.client.workspaceProviderSetupBegin({ repoPath });
          const committed = await connection.host.client.workspaceProviderSetupCommit({
            ...setup,
            workspaceId: "mobile-fixture",
            workspaceName: "Mobile fixture",
            defaultTargetBranch: { branch: "main" },
            agentDefaults: {},
          });
          await connection.host.client.workspaceProviderSetupDiscard({ setupId: setup.setupId });
          const workspace = committed.workspace;
          assert.ok(workspace, committed.error ?? "The setup commit created no workspace.");
          const listed = await connection.queryClient.fetchQuery(workspaceListQueryOptions());
          assert.ok(listed.some((record) => record.workspaceId === workspace.workspaceId));
          const created = await connection.host.client.taskCreate(workspace, {
            title: "Check the mobile client",
            issueType: "task",
            priority: 2,
          });
          const taskData = await connection.queryClient.fetchQuery(
            repoTaskDataQueryOptions(workspace),
          );
          assert.ok(taskData.tasks.some((task) => task.id === created.id));
          const runtimeStatus = await connection.host.client.runtimeStatus();
          assert.equal(
            runtimeStatus.hostInstanceId,
            remote.remote.readState().host?.hostInstanceId,
          );

          // Retry reconnects to the same host instance.
          const generation = remote.remote.readState().generation;
          await remote.remote.retry();
          const reconnected = remote.remote.readState();
          assert.equal(reconnected.status, "connected");
          assert.ok(reconnected.generation > generation);
          await waitForConnectedClients(1);
          assert.equal(
            (await connection.host.client.runtimeStatus()).hostInstanceId,
            runtimeStatus.hostInstanceId,
          );

          // Removing the host releases the admission and deletes its local data.
          await owner.removeHost("real-host");
          // Releasing the admission ends its streams, so the host shows the device offline at once.
          await waitForConnectedClients(0);
          assert.deepEqual(hostStores.deleted, ["real-host"]);
          assert.equal(owner.getState().status, "no_host");
        } finally {
          const state = owner.getState();
          if (state.status === "active" && state.session.kind === "remote") {
            await owner.removeHost(state.session.host.id);
          }
        }
      } finally {
        await backend.stop();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  // The test starts a real host, initializes a Git repository, and makes loopback requests.
  25_000,
);
