import { RemoteConnectionError, isRemotePairingFailure } from "@openducktor/host-client/remote";
import { errorMessage } from "./errors";

/** A failed remote connection, with its reason and next action. */
export type RemoteConnectionFailure = {
  message: string;
  nextAction: string | null;
  /** True when a new pairing code can solve it. */
  pairing: boolean;
};

export const describeRemoteConnectionFailure = (cause: unknown): RemoteConnectionFailure => {
  if (cause instanceof RemoteConnectionError)
    return {
      message: cause.failure.message,
      nextAction: cause.failure.nextAction,
      pairing: isRemotePairingFailure(cause.failure.code),
    };
  return { message: errorMessage(cause), nextAction: null, pairing: false };
};
