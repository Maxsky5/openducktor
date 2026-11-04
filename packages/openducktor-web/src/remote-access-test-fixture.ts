import { Effect, Stream } from "effect";
import type { RemoteAccessController } from "@openducktor/remote-host";
export const remoteAccessFixture = (): RemoteAccessController => ({
  readState: () =>
    Effect.succeed({
      status: "disabled",
      configuration: null,
      pairing: null,
      clients: [],
      connectedClients: 0,
    }),
  readNetworks: () => Effect.succeed([]),
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
});
