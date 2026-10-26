import { afterAll, describe, expect, test } from "bun:test";
import { type AddressInfo, createServer, type Server } from "node:net";
import os from "node:os";
import type { RemoteAccessSettings } from "@openducktor/contracts";
import { Effect } from "effect";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import {
  makeService,
  removeFakeShell,
} from "../../host/src/application/terminals/test-support/terminal-service-harness";
import { HostOperationError } from "../../host/src/effect/host-errors";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createEffectHostCommandRouter } from "../../host/src/interface/router/host-command-router";
import { createHostCommandLifetime } from "./host-command-lifetime";
import { BufferedHostEventBus } from "./host-event-bus";
import { createRemoteAccessController } from "./remote-access-controller";
import { createRemoteAccessOperator } from "./remote-access-operator";

afterAll(removeFakeShell);

const networkAddress = (): string => {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && !entry.internal && entry.family === "IPv4")?.address;
  if (!address) throw new Error("This HTTP test needs a non-loopback IPv4 network.");
  return address;
};

/** The settings file of the host, kept in memory. */
const createSettingsFile = (
  initial: RemoteAccessSettings = { enabled: false, configuration: null },
) => {
  const file = { remoteAccess: initial, saves: 0, failSaves: false };
  return {
    file,
    store: {
      readHostId: () => Effect.succeed("stable-host-a"),
      readRemoteAccessSettings: () => Effect.sync(() => file.remoteAccess),
      saveRemoteAccessSettings: (settings: RemoteAccessSettings) =>
        file.failSaves
          ? Effect.fail(
              new HostOperationError({ operation: "settings.write", message: "Disk full" }),
            )
          : Effect.sync(() => {
              file.remoteAccess = settings;
              file.saves += 1;
            }),
    },
  };
};

/** A host run: the controller and the operator over the same settings file. */
const startHost = async (settings: ReturnType<typeof createSettingsFile>) => {
  const terminal = await makeService();
  const router = createEffectHostCommandRouter({ handlers: {} });
  const controller = createRemoteAccessController(
    {
      ...router,
      invoke: createHostCommandLifetime(router).invoke,
      hostInstanceId: crypto.randomUUID(),
      hostSettings: settings.store,
      terminalService: terminal.service,
      taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
      notificationStream: createNotificationStream(),
      taskAssetReadService: {
        read: () => Effect.succeed(null),
        readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
      },
      eventBus: new BufferedHostEventBus({ report: () => {} }),
    },
    {
      shell: "electron",
      appVersion: "host-test",
      logger: { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
      reportFailure: () => {},
    },
  );
  const failures: unknown[] = [];
  const operator = createRemoteAccessOperator(controller, settings.store, {
    reportFailure: (cause) => failures.push(cause),
  });
  return {
    operator,
    failures,
    stop: () => Effect.runPromise(controller.close()),
  };
};

/** Another app that holds a port. */
const holdPort = async (host: string, port = 0): Promise<{ server: Server; port: number }> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  // SAFETY: a TCP server that listens on a host and a port reports an AddressInfo.
  const address = server.address() as AddressInfo;
  return { server, port: address.port };
};

const release = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe("remote access operator", () => {
  test("saves the bound port, and a restart starts remote control at the same address", async () => {
    const listenHost = networkAddress();
    const settings = createSettingsFile();
    const first = await startHost(settings);
    let address: string;
    try {
      const state = await Effect.runPromise(first.operator.enable({ listenHost, listenPort: 0 }));
      expect(state.status).toBe("available");
      address = state.configuration!.publicEndpoint;
      expect(settings.file.remoteAccess).toEqual({
        enabled: true,
        configuration: { listenHost, listenPort: Number(new URL(address).port) },
      });
    } finally {
      await first.stop();
    }
    const second = await startHost(settings);
    try {
      await Effect.runPromise(second.operator.restore({}));
      const state = await Effect.runPromise(second.operator.readState());
      expect(state.status).toBe("available");
      expect(state.configuration!.publicEndpoint).toBe(address);
      const discovery = await fetch(address);
      expect(await discovery.json()).toMatchObject({ hostId: "stable-host-a" });
    } finally {
      await second.stop();
    }
  });

  test("keeps the listener when disabled and shows it for the next enable", async () => {
    const listenHost = networkAddress();
    const settings = createSettingsFile();
    const host = await startHost(settings);
    try {
      const on = await Effect.runPromise(host.operator.enable({ listenHost, listenPort: 0 }));
      const off = await Effect.runPromise(host.operator.disable());
      expect(off.status).toBe("disabled");
      expect(off.configuration?.publicEndpoint).toBe(on.configuration!.publicEndpoint);
      expect(settings.file.remoteAccess.enabled).toBe(false);
      expect(settings.file.remoteAccess.configuration?.listenPort).toBe(
        on.configuration!.listenPort,
      );
    } finally {
      await host.stop();
    }
  });

  test("names a port in use and saves nothing", async () => {
    const listenHost = networkAddress();
    const held = await holdPort(listenHost);
    const settings = createSettingsFile();
    const host = await startHost(settings);
    try {
      const result = await Effect.runPromise(
        Effect.result(host.operator.enable({ listenHost, listenPort: held.port })),
      );
      expect(result._tag).toBe("Failure");
      const state = await Effect.runPromise(host.operator.readState());
      expect(state.status).toBe("failed");
      expect(state.failure?.code).toBe("port_in_use");
      expect(state.failure?.message).toBe(`Port ${held.port} is in use by another app.`);
      expect(settings.file.saves).toBe(0);
    } finally {
      await host.stop();
      await release(held.server);
    }
  });

  test("shows a busy saved port after a restart and keeps the saved listener", async () => {
    const listenHost = networkAddress();
    const held = await holdPort(listenHost);
    const saved = { enabled: true, configuration: { listenHost, listenPort: held.port } };
    const settings = createSettingsFile(saved);
    const host = await startHost(settings);
    try {
      await Effect.runPromise(host.operator.restore({}));
      const state = await Effect.runPromise(host.operator.readState());
      expect(state.status).toBe("failed");
      expect(state.failure?.code).toBe("port_in_use");
      expect(state.configuration?.listenPort).toBe(held.port);
      expect(settings.file.remoteAccess).toEqual(saved);
    } finally {
      await host.stop();
      await release(held.server);
    }
  });

  test("starts from environment variables without saving them", async () => {
    const listenHost = networkAddress();
    const free = await holdPort(listenHost);
    await release(free.server);
    const saved = { enabled: false, configuration: { listenHost, listenPort: 14_328 } };
    const settings = createSettingsFile(saved);
    const host = await startHost(settings);
    try {
      await Effect.runPromise(
        host.operator.restore({
          OPENDUCKTOR_REMOTE_HOST: listenHost,
          OPENDUCKTOR_REMOTE_PORT: String(free.port),
          OPENDUCKTOR_REMOTE_ENDPOINT: `http://${listenHost}:${free.port}`,
        }),
      );
      const state = await Effect.runPromise(host.operator.readState());
      expect(state.status).toBe("available");
      expect(state.configuration?.listenPort).toBe(free.port);
      expect(settings.file.remoteAccess).toEqual(saved);
    } finally {
      await host.stop();
    }
  });

  test("keeps remote control on and shows a settings file that it could not write", async () => {
    const listenHost = networkAddress();
    const settings = createSettingsFile();
    settings.file.failSaves = true;
    const host = await startHost(settings);
    try {
      const state = await Effect.runPromise(host.operator.enable({ listenHost, listenPort: 0 }));
      expect(state.status).toBe("available");
      expect(state.failure?.message).toBe("Remote control could not save its settings: Disk full");
      settings.file.failSaves = false;
      const next = await Effect.runPromise(host.operator.enable({ listenHost, listenPort: 0 }));
      expect(next.failure).toBeUndefined();
    } finally {
      await host.stop();
    }
  });
});
