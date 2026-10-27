import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_CONNECTION_HEADER,
  REMOTE_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import { createEffectHostCommandRouter } from "../../host/src/interface/router/host-command-router";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import { readSse } from "../../host-client/src/remote/sse";
import { BufferedHostEventBus } from "./host-event-bus";
import { createRemoteWorkInterface, type RemoteHostServices } from "./remote-work-interface";
import { startNodeFetchServer } from "./node-fetch-server";

test("Node listener setup sees its assigned port and closes the socket when setup fails", async () => {
  let port = 0;
  let listener: Awaited<ReturnType<typeof startNodeFetchServer>> | undefined;
  try {
    let failure: unknown;
    try {
      listener = await startNodeFetchServer({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response("unexpected"),
        onError: (cause) => {
          throw cause;
        },
        onListening: (server) => {
          port = server.port;
          throw new Error("Work setup failed.");
        },
      });
    } catch (cause) {
      failure = cause;
    }
    assert.match(String(failure), /Work setup failed/);
    assert.ok(port > 0);
    let ready = false;
    const replacement = await startNodeFetchServer({
      hostname: "127.0.0.1",
      port,
      onListening: (server) => {
        assert.equal(server.port, port);
        ready = true;
      },
      fetch: () => {
        assert.equal(ready, true);
        return new Response("ready");
      },
      onError: (cause) => {
        throw cause;
      },
    });
    try {
      assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "ready");
    } finally {
      await replacement.stop(true);
    }
  } finally {
    await listener?.stop(true);
  }
});

for (const shell of ["electron", "web"] as const) {
  test(`${shell} reads admitted POST bodies on Node with retained or stripped prefixes`, async () => {
    const themes: string[] = [];
    const router = createEffectHostCommandRouter({
      handlers: {
        set_theme: (args) =>
          Effect.sync(() => {
            themes.push(String(args?.theme));
          }),
      },
    });
    const notifications = createNotificationStream();
    const work = createRemoteWorkInterface(
      {
        ...router,
        hostInstanceId: "host-body-test",
        hostSettings: {
          readHostId: () => Effect.succeed("stable-host-a"),
          readRemoteAccessSettings: () => Effect.succeed({ enabled: false, configuration: null }),
          saveRemoteAccessSettings: () => Effect.void,
        },
        taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
        notificationStream: notifications,
        taskAssetReadService: { read: () => Effect.succeed(null) },
        eventBus: new BufferedHostEventBus({ report: () => {} }),
        get terminalService(): RemoteHostServices["terminalService"] {
          throw new Error("POST routes must not use the terminal service.");
        },
      },
      {
        shell,
        appVersion: "host-test",
        hostId: "stable-host-a",
        listenHost: "127.0.0.1",
        publicEndpoint: "https://machine.test/api/remote",
        logger: { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
        reportFailure: (cause) => {
          throw cause;
        },
      },
    );
    const server = await startNodeFetchServer({
      hostname: "127.0.0.1",
      port: 0,
      fetch: work.handle,
      onError: (cause) => {
        throw cause;
      },
    });
    try {
      for (const prefix of ["/api/remote", ""]) {
        const base = `http://127.0.0.1:${server.port}${prefix}`;
        const admitted = await fetch(`${base}/connections`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appVersion: "mobile-test",
            supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
            requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
            optionalCapabilities: [],
          }),
        });
        assert.equal(admitted.status, 201);
        const { connectionId } = await admitted.json();
        const headers = {
          "content-type": "application/json",
          [REMOTE_CONNECTION_HEADER]: connectionId,
        };
        const command = await fetch(`${base}/invoke/set_theme`, {
          method: "POST",
          headers,
          body: JSON.stringify({ theme: "dark" }),
        });
        assert.equal(command.status, 200, await command.text());
        const subscription = await fetch(`${base}/task-events/subscriptions`, {
          method: "POST",
          headers,
          body: JSON.stringify({ cursor: null }),
        });
        assert.equal(subscription.status, 201);
        const { subscriptionId, replayBoundary } = await subscription.json();
        const stream = await fetch(`${base}/task-events/subscriptions/${subscriptionId}/stream`, {
          headers,
        });
        assert.equal(stream.status, 200);
        assert.ok(stream.body);
        const frames = readSse(stream.body, new AbortController().signal);
        try {
          const delivered = await frames.next();
          assert.equal(delivered.done, false);
          assert.equal(delivered.value.event, "task-frame");
          const { cursor } = JSON.parse(delivered.value.data);
          assert.deepEqual(cursor, replayBoundary);
          const acknowledged = await fetch(
            `${base}/task-events/subscriptions/${subscriptionId}/ack`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ cursor }),
            },
          );
          assert.equal(acknowledged.status, 204, await acknowledged.text());
        } finally {
          await frames.return();
        }
        const malformed = await fetch(`${base}/invoke/set_theme`, {
          method: "POST",
          headers,
          body: "{",
        });
        assert.equal(malformed.status, 400);
        assert.equal((await malformed.json()).failure.code, "invalid_protocol");
      }
      assert.deepEqual(themes, ["dark", "dark"]);
    } finally {
      work.close();
      await server.stop(true);
      await Effect.runPromise(notifications.dispose());
    }
  });
}
