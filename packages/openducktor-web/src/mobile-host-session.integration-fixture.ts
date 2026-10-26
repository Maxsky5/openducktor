// Connects the mobile host session owner to a real TypeScript host with Remote control on.
// The parent test runs this file in a child process, so host state stays out of other tests.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { RemoteHttpResponse, RemoteTransport } from "@openducktor/host-client/remote";
import { remoteError } from "@openducktor/host-client/remote";
import { createHostSessionOwner } from "../../../apps/mobile/src/host-session/host-session-owner";
import {
  createMemoryDeviceStore,
  createMemoryHostStores,
  createRecordingFeedback,
} from "../../../apps/mobile/src/test-support/memory-device-store";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { workspaceListQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type { WebLogger } from "./logger";
import { startTypescriptHostBackend } from "./typescript-host-backend";

const logger: WebLogger = {
  error: () => Effect.void,
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
    openTerminal: async () => {
      throw remoteError(
        "function_unavailable",
        "This fixture does not open terminals.",
        "Use the terminal tests.",
      );
    },
  };
};

const waitFor = async (check: () => boolean, description: string) => {
  const deadline = Date.now() + 8_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const backend = await startTypescriptHostBackend({
  port: 0,
  host: "127.0.0.1",
  frontendOrigin: "http://127.0.0.1:1420",
  appToken: "mobile-fixture-app-token",
  controlToken: "mobile-fixture-control-token",
  configDirScope: "test",
  mcpBridgeDiscoveryMode: "production",
  runtimeDistribution: { mode: "source", workspaceRoot: process.cwd() },
  deferRemoteStartup: true,
  logger,
  onBackgroundFailure: (cause) => console.error("Host background failure", cause),
});

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
  });
  owner.start();

  // Discovery, negotiation, the event stream, and the first synchronization use the real host.
  const added = await owner.addHost(endpoint.href);
  assert.equal(added.kind, "added");
  assert.equal(added.host.shell, "web");
  const state = owner.getState();
  assert.equal(state.status, "active");
  if (state.status !== "active") throw new Error("The host did not become active.");
  const { connection, remote } = state.session;
  assert.equal(remote.remote.readState().status, "connected");

  // Host commands run through the admitted connection.
  const workspaces = await connection.host.client.workspaceList();
  assert.ok(Array.isArray(workspaces));

  // A workspace and a task round-trip through the same query caches that the app reads.
  const repoPath = mkdtempSync(join(tmpdir(), "odt-mobile-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
      cwd: repoPath,
      stdio: "ignore",
    });
  git("init", "--initial-branch=main");
  writeFileSync(join(repoPath, "README.md"), "# Mobile fixture\n");
  git("add", ".");
  git("commit", "-m", "Initial commit");
  const workspace = await connection.host.client.workspaceAdd({
    workspaceId: "mobile-fixture",
    workspaceName: "Mobile fixture",
    repoPath,
  });
  const listed = await connection.queryClient.fetchQuery(workspaceListQueryOptions());
  assert.ok(listed.some((record) => record.workspaceId === workspace.workspaceId));
  const created = await connection.host.client.taskCreate(workspace.repoPath, {
    title: "Check the mobile client",
    issueType: "task",
    priority: 2,
    aiReviewEnabled: true,
  });
  const taskData = await connection.queryClient.fetchQuery(
    repoTaskDataQueryOptions(workspace.repoPath),
  );
  assert.ok(taskData.tasks.some((task) => task.id === created.id));
  const runtimeStatus = await connection.host.client.runtimeStatus();
  assert.equal(runtimeStatus.hostInstanceId, remote.remote.readState().host?.hostInstanceId);

  // A dropped connection reconnects to the same host run and restores work.
  const generation = remote.remote.readState().generation;
  await remote.remote.retry();
  await waitFor(
    () =>
      remote.remote.readState().status === "connected" &&
      remote.remote.readState().generation > generation,
    "the reconnect",
  );

  // Removing the host releases the admission and deletes its local data.
  await owner.removeHost("real-host");
  assert.deepEqual(hostStores.deleted, ["real-host"]);
  assert.equal(owner.getState().status, "no_host");
} finally {
  await backend.stop();
}
