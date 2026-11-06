import { expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { RemoteAccessError, type RemoteAccessOperator } from "@openducktor/remote-host";
import { createRemoteAccessIpcHandler } from "./electron-remote-access-ipc";

test("Electron operator IPC keeps the next action when network reads or client revocation fail", async () => {
  const controller: RemoteAccessOperator = {
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
    restore: () => Effect.void,
  };
  const handle = createRemoteAccessIpcHandler(controller, () => false);
  {
    expect(await handle({ action: "networks" })).toEqual([
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
      await handle({ action: "networks" });
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
    const revokeFailure = await handle({
      action: "revoke",
      clientId: "10000000-0000-4000-8000-000000000001",
    }).catch((cause: unknown) => cause);
    expect(revokeFailure).toMatchObject({
      message: "Could not remove saved access. Check the host directory permissions, then retry.",
    });
  }
});
