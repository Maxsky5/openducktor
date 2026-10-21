import type { BrowserTabOwner } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { BrowserService } from "./browser-service-types";

/** Closes the browser tabs of a task or Workspace Session that goes away. */
export type BrowserOwnerCleanupPort = Pick<BrowserService, "closeOwnerTabs">;

/** Closes the browser tabs of each owner, and names the owner kind in a failure. */
export const closeOwnerBrowserTabs = (
  browserTabs: BrowserOwnerCleanupPort,
  owners: readonly BrowserTabOwner[],
  operation: string,
): Effect.Effect<void, HostOperationError> =>
  Effect.forEach(
    owners,
    (owner) =>
      browserTabs.closeOwnerTabs(owner).pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation,
              message: `Could not close the browser tabs of this ${owner.kind === "task" ? "task" : "chat"}: ${cause.message}`,
              cause,
            }),
        ),
      ),
    { discard: true },
  );
