import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { Effect, Fiber, Stream } from "effect";
import { RemoteAccessError, type RemoteAccessController } from "@openducktor/remote-host";
import { ELECTRON_REMOTE_ACCESS_CHANNEL } from "../shared/electron-bridge-contract";
import { registerElectronRemoteAccessIpc } from "./electron-remote-access-ipc";

test("Electron operator IPC reads networks and keeps the next action when the network read fails", async () => {
  const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>();
  const ipc = {
    handle: (channel: string, handler: Parameters<IpcMain["handle"]>[1]) =>
      handlers.set(channel, handler),
  };
  const controller: RemoteAccessController = {
    readState: () => Effect.succeed({ status: "disabled", configuration: null }),
    readNetworks: () => Effect.succeed([{ name: "wifi", address: "192.168.1.9" }]),
    states: Stream.empty,
    enable: () => Effect.succeed({ status: "available", configuration: null }),
    disable: () => Effect.succeed({ status: "disabled", configuration: null }),
    close: () => Effect.void,
    handleSharedRequest: () => null,
  };
  // SAFETY: Registration uses only handle; the fake records Electron's invoke handlers.
  const fiber = registerElectronRemoteAccessIpc(ipc as IpcMain, controller, () => false);
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send() {} });
  const senderEvents: EventEmitter = sender;
  // SAFETY: This handler uses only sender.once, sender.isDestroyed, and sender.send.
  const event = { sender: senderEvents as Electron.WebContents } as IpcMainInvokeEvent;
  try {
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
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber));
  }
});
