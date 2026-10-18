import { Effect, Stream } from "effect";
import type { RemoteAccessController } from "@openducktor/remote-host";
export const remoteAccessFixture = (): RemoteAccessController => ({
  readState: () => Effect.succeed({ status: "disabled", configuration: null, connectedClients: 0 }),
  readNetworks: () => Effect.succeed([]),
  states: Stream.empty,
  enable: () => Effect.succeed({ status: "available", configuration: null, connectedClients: 0 }),
  disable: () => Effect.succeed({ status: "disabled", configuration: null, connectedClients: 0 }),
  close: () => Effect.void,
  handleSharedRequest: () => null,
});
