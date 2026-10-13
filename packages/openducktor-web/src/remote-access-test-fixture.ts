import { Effect, Stream } from "effect";
import type { RemoteAccessController } from "@openducktor/remote-host";
export const remoteAccessFixture = (): RemoteAccessController => ({
  readState: () => Effect.succeed({ status: "disabled", configuration: null }),
  readNetworks: () => Effect.succeed([]),
  states: Stream.empty,
  enable: () => Effect.succeed({ status: "available", configuration: null }),
  disable: () => Effect.succeed({ status: "disabled", configuration: null }),
  close: () => Effect.void,
  handleSharedRequest: () => null,
});
