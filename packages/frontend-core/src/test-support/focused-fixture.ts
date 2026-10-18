import { createHostClient, type HostClient } from "@openducktor/host-client";

export const createHostClientFixture = <Overrides extends Partial<HostClient>>(
  overrides: Overrides,
): HostClient =>
  Object.assign(
    createHostClient(async () => {
      throw new Error("Host client method is not configured for this test.");
    }),
    overrides,
  );
