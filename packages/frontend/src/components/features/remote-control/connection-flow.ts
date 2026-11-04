import type { RemoteConnectionFailure } from "@openducktor/frontend-core/lib/remote-connection-failure";

// The rules and copy that the connect form and the re-pair form share.

/** How long the Connected view stays before the host opens. */
export const CONNECTED_VIEW_MS = 1000;

/** Waits while the Connected view shows. */
export const waitForConnectedView = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, CONNECTED_VIEW_MS));

/** The failure that a code field shows before any submit. */
export const incompleteCodeFailure: RemoteConnectionFailure = {
  message: "Enter all six digits of the pairing code.",
  nextAction: null,
  pairing: true,
};

/** The title and text above the re-pair form. */
export const PAIR_WITH_HOST = {
  title: "Pair with host",
  description: "Enter the code from the computer you want to use.",
} as const;
