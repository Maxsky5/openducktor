import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import assert from "node:assert/strict";
import { spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { createLocalAttachmentAdapter } from "@openducktor/host";
import { HostInvokeError } from "@openducktor/host-client";
import {
  LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE,
  REMOTE_CONNECTION_HEADER,
} from "@openducktor/contracts";
import { createLocalAttachmentService } from "../../host/src/application/attachments/local-attachment-service";
import { createLocalAttachmentCommandHandlers } from "../../host/src/interface/commands/local-attachment-command-handlers";
import { createEffectHostCommandRouter } from "../../host/src/interface/router/host-command-router";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import {
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This child-process test fixture uses the test harness.
  makeService,
  removeFakeShell,
} from "../../host/src/application/terminals/test-support/terminal-service-harness";
import { createRemoteWorkInterface } from "@openducktor/remote-host";
import { BufferedHostEventBus } from "@openducktor/remote-host/host-event-bus";
import { startNodeFetchServer } from "@openducktor/remote-host/node-fetch-server";
import { terminalWebSocketHandler } from "@openducktor/remote-host/terminals/terminal-websocket-handler";
import { createRemoteShellBridge } from "@openducktor/frontend/lib/remote/shell-bridge";
import { watchClientPage } from "@openducktor/frontend/lib/client-page";
import { createBrowserRemoteTransport } from "@openducktor/frontend/lib/remote/transport";
import { createBrowserNotificationBridge } from "./browser-notification-bridge";

const stage = createLocalAttachmentAdapter().stageDirectory();
await mkdir(stage, { recursive: true });
const directory = await mkdtemp(path.join(stage, "remote-resource-test-"));
const previewPath = path.join(directory, "preview.png");
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
await writeFile(previewPath, image);
const attachments = createLocalAttachmentService(createLocalAttachmentAdapter());
const lookupName = `preview-${crypto.randomUUID()}.png`;
const staged = await Effect.runPromise(
  attachments.stage({ name: lookupName, base64Data: image.toString("base64") }),
);
const outsidePath = path.resolve(stage, "..", `${crypto.randomUUID()}.png`);
await writeFile(outsidePath, image);
const terminal = await makeService();
const notifications = createNotificationStream();
const router = createEffectHostCommandRouter({
  handlers: {
    system_get_platform: () => Effect.succeed("linux"),
    ...createLocalAttachmentCommandHandlers(attachments),
  },
});
const work = createRemoteWorkInterface(
  {
    ...router,
    hostInstanceId: "host-a",
    hostSettings: {
      readHostId: () => Effect.succeed("stable-host-a"),
      readRemoteAccessSettings: () => Effect.succeed({ enabled: false, configuration: null }),
      saveRemoteAccessSettings: () => Effect.void,
    },
    eventBus: new BufferedHostEventBus({ report: () => {} }),
    notificationStream: notifications,
    taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
    terminalService: terminal.service,
    taskAssetReadService: {
      readBatch: () => Effect.die("Unexpected task asset batch read."),
      read: () =>
        Effect.succeed({
          bytes: image,
          mediaType: "image/png" as const,
          headers: {
            "Content-Type": "image/png" as const,
            "Cache-Control": "no-store, private",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
          },
        }),
    },
  },
  {
    shell: "web",
    appVersion: "test-host",
    hostId: "stable-host-a",
    listenHost: "127.0.0.1",
    publicEndpoint: "http://machine.test/remote",
    logger: { info: () => Effect.void, error: () => Effect.void, success: () => Effect.void },
    reportFailure: (cause) => {
      throw cause;
    },
  },
);
const server = await startNodeFetchServer({
  hostname: "127.0.0.1",
  port: 0,
  fetch: work.handle,
  websocket: terminalWebSocketHandler,
  onError: (cause) => {
    throw cause;
  },
});
const endpoint = `http://machine.test:${server.port}/remote`;
const nativeFetch = globalThis.fetch;
let released = Promise.withResolvers<string>();
let releases = 0;
let requests = 0;
const fetch = spyOn(globalThis, "fetch").mockImplementation(
  Object.assign(
    async (input: Parameters<typeof nativeFetch>[0], init?: Parameters<typeof nativeFetch>[1]) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(endpoint)) return nativeFetch(input, init);
      requests += 1;
      const headers = new Headers(init?.headers);
      if (init?.method === "DELETE") releases += 1;
      // Map the public hostname to loopback without changing the browser's request URL.
      headers.set("host", new URL(url).host);
      const local = new URL(url);
      local.hostname = "127.0.0.1";
      const response = await nativeFetch(local, { ...init, headers });
      Object.defineProperty(response, "url", { value: url });
      if (init?.method === "DELETE") {
        assert.equal(response.status, 204);
        released.resolve(headers.get(REMOTE_CONNECTION_HEADER)!);
      }
      return response;
    },
    { preconnect: nativeFetch.preconnect },
  ),
);
const bridges: ReturnType<typeof createRemoteShellBridge>[] = [];
const pages: EventTarget[] = [];
const documents: Array<EventTarget & { hidden: boolean }> = [];
const connected = (bridge: ReturnType<typeof createRemoteShellBridge>) =>
  new Promise<void>((resolve, reject) => {
    let stop = () => {};
    let settled = false;
    stop = bridge.remoteConnection!.subscribeState((state) => {
      if (state.status === "connected") {
        settled = true;
        stop();
        resolve();
      } else if (state.status === "failed") {
        settled = true;
        stop();
        reject(new Error(state.failure?.message));
      }
    });
    if (settled) stop();
  });
const connect = async () => {
  const page = Object.assign(new EventTarget(), { location: { origin: "http://machine.test" } });
  const document = Object.assign(new EventTarget(), { hidden: false });
  pages.push(page);
  documents.push(document);
  Object.defineProperty(globalThis, "window", { configurable: true, value: page });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const bridge = createRemoteShellBridge({
    endpoint,
    version: "test-browser",
    transport: createBrowserRemoteTransport(),
    notifications: createBrowserNotificationBridge({ scope: endpoint }),
    queryClient: createClientQueryClient(),
  });
  watchClientPage(bridge, () => false);
  bridges.push(bridge);
  await connected(bridge);
  return bridge;
};

try {
  const a = await connect();
  await connect();
  pages[1]!.dispatchEvent(new Event("pagehide"));
  await released.promise;
  assert.equal(a.remoteConnection!.readState().status, "connected");
  assert.equal(await a.client.systemGetPlatform(), "linux");
  const document = documents[0]!;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const before = releases;
    const beforeRequests = requests;
    const generation = a.remoteConnection!.readState().generation;
    for (const hidden of [true, false]) {
      document.hidden = hidden;
      document.dispatchEvent(new Event("visibilitychange"));
      assert.equal(a.remoteConnection!.readState().status, "connected");
      assert.equal(a.remoteConnection!.readState().generation, generation);
      assert.equal(releases, before, "Switching tabs must keep the current admission.");
      assert.equal(requests, beforeRequests, "Switching tabs must not restart transport.");
    }
    assert.equal(await a.client.systemGetPlatform(), "linux");
  }
  for (const hidden of [false, true]) {
    released = Promise.withResolvers<string>();
    const before = releases;
    document.hidden = true;
    pages[0]!.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
    assert.equal(releases - before, 1, "Caching the page must release its admission.");
    const id = await released.promise;
    const expired = await globalThis.fetch(`${endpoint}/invoke/system_get_platform`, {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: id },
      body: "{}",
    });
    assert.equal(expired.status, 409, "The released admission must not admit work.");
    await expired.body?.cancel();
    assert.equal(a.remoteConnection!.readState().status, "idle");
    const ready = connected(a);
    const beforeRequests = requests;
    document.hidden = hidden;
    pages[0]!.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    if (hidden) {
      assert.equal(requests, beforeRequests, "A hidden restored page must stay paused.");
      document.hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    }
    assert.notEqual(
      a.remoteConnection!.readState().status,
      "idle",
      "A visible restored page must reconnect.",
    );
    await ready;
    assert.equal(await a.client.systemGetPlatform(), "linux");
  }
  for (let cycle = 0; cycle < 33; cycle += 1) {
    const abort = new AbortController();
    const received = Promise.withResolvers<import("@openducktor/contracts").TaskEventStreamFrame>();
    const subscription = await a.subscribeTaskStream(
      { cursor: null },
      received.resolve,
      received.reject,
      abort.signal,
    );
    const frame = await received.promise;
    await subscription.acknowledge(frame.cursor);
    abort.abort();
    await subscription.unsubscribe();
  }
  assert.equal(a.remoteConnection!.readState().status, "connected");
  const asset = await a.resolveTaskAssetSource(
    {
      workspaceId: "workspace",
      taskId: "task",
      scope: "description",
      assetId: "550e8400-e29b-41d4-a716-446655440000",
    },
    new AbortController().signal,
  );
  const previews = [];
  for (const file of [previewPath, lookupName]) {
    const before = requests;
    previews.push(await a.resolveLocalAttachmentPreview(file, new AbortController().signal));
    assert.equal(requests - before, 1, "Each preview needs one remote request.");
  }
  for (const source of [asset, ...previews]) {
    assert.equal(source.kind, "blob");
    if (source.kind !== "blob") throw new Error("Expected remote resource bytes.");
    const src = URL.createObjectURL(source.blob);
    try {
      const response = await globalThis.fetch(src);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(image));
    } finally {
      URL.revokeObjectURL(src);
    }
  }
  for (const [file, message] of [
    [path.join(stage, "missing.png"), LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE],
    [outsidePath, "Attachment path is not a staged local attachment."],
  ] as const) {
    await assert.rejects(a.resolveLocalAttachmentPreview(file, new AbortController().signal), {
      name: HostInvokeError.name,
      message,
    });
    assert.equal(a.remoteConnection!.readState().status, "connected");
  }
} finally {
  for (const page of pages) page.dispatchEvent(new Event("pagehide"));
  for (const bridge of bridges) bridge.notifications.dispose();
  work.close();
  await server.stop(true);
  await Effect.runPromise(notifications.dispose());
  await Effect.runPromise(terminal.service.dispose());
  fetch.mockRestore();
  await rm(directory, { recursive: true, force: true });
  await rm(staged.path, { force: true });
  await rm(outsidePath, { force: true });
  await removeFakeShell();
}
