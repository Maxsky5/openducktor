import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { Effect, Stream } from "effect";
import { RemoteAccessError, type RemoteAccessController } from "@openducktor/remote-host";
import { ELECTRON_REMOTE_ACCESS_CHANNEL } from "../shared/electron-bridge-contract";
import { registerElectronRemoteAccessIpc } from "./electron-remote-access-ipc";

test("Electron operator IPC keeps the next action when network reads or client revocation fail", async () => {
  const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>();
  const ipc = {
    handle: (channel: string, handler: Parameters<IpcMain["handle"]>[1]) =>
      handlers.set(channel, handler),
  };
  const controller: RemoteAccessController = {
    readState: () =>
      Effect.succeed({
        status: "disabled",
        configuration: null,
        pairing: null,
        clients: [],
        connectedClients: 0,
      }),
    readNetworks: () => Effect.succeed([{ name: "wifi", address: "192.168.1.9" }]),
    states: Stream.empty,
    enable: () =>
      Effect.succeed({
        status: "available",
        configuration: null,
        pairing: null,
        clients: [],
        connectedClients: 0,
      }),
    revokeClient: () =>
      Effect.succeed({
        status: "disabled",
        configuration: null,
        pairing: null,
        clients: [],
        connectedClients: 0,
      }),
    disable: () =>
      Effect.succeed({
        status: "disabled",
        configuration: null,
        pairing: null,
        clients: [],
        connectedClients: 0,
      }),
    startPairing: () =>
      Effect.succeed({
        status: "available",
        configuration: null,
        pairing: { code: "012345", expiresAt: "2030-01-01T00:00:00.000Z" },
        clients: [],
        connectedClients: 0,
      }),
    stopPairing: () =>
      Effect.succeed({
        status: "available",
        configuration: null,
        pairing: null,
        clients: [],
        connectedClients: 0,
      }),
    close: () => Effect.void,
    handleSharedRequest: () => null,
  };
  // SAFETY: Registration uses only handle; the fake records Electron's invoke handlers.
  registerElectronRemoteAccessIpc(ipc as IpcMain, controller, () => false);
  const sender: EventEmitter = new EventEmitter();
  // SAFETY: The handler reads no field of the invoke event or its sender.
  const event = { sender: sender as Electron.WebContents } as IpcMainInvokeEvent;
  {
    const handle = handlers.get(ELECTRON_REMOTE_ACCESS_CHANNEL);
    if (!handle) throw new Error("Remote access IPC was not registered.");
    expect(await handle(event, { action: "networks" })).toEqual([
      { name: "wifi", address: "192.168.1.9" },
    ]);
    controller.readNetworks = () =>
      Effect.fail(
        new RemoteAccessError({
          failure: {
            code: "unavailable",
            message: "Could not read networks.",
            nextAction: "Check the network connection, then refresh.",
          },
        }),
      );
    let failure: unknown;
    try {
      await handle(event, { action: "networks" });
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toEqual(
      new Error("Could not read networks. Check the network connection, then refresh."),
    );
    controller.revokeClient = () =>
      Effect.fail(
        new RemoteAccessError({
          failure: {
            code: "authorization_storage_failed",
            message: "Could not remove saved access.",
            nextAction: "Check the host directory permissions, then retry.",
          },
        }),
      );
    const revokeFailure = await handle(event, {
      action: "revoke",
      clientId: "10000000-0000-4000-8000-000000000001",
    }).catch((cause: unknown) => cause);
    expect(revokeFailure).toMatchObject({
      message: "Could not remove saved access. Check the host directory permissions, then retry.",
    });
  }
});
