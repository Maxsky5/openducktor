import type { BrowserTabOwner } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { BrowserService } from "./browser-service-types";
import { addBackgroundStepDetail } from "../operation-progress/background-operation-progress";

/** Closes the browser tabs of a task or Workspace Session that goes away. */
export type BrowserOwnerCleanupPort = Pick<BrowserService, "closeOwnerTabs">;

/** Closes the browser tabs of each owner, and names the owner kind in a failure. */
export const closeOwnerBrowserTabs = (
  browserTabs: BrowserOwnerCleanupPort,
  owners: readonly BrowserTabOwner[],
  operation: string,
): Effect.Effect<boolean, HostOperationError> =>
  Effect.gen(function* () {
    let closedCount = 0;
    const result = yield* Effect.forEach(owners, (owner) =>
      browserTabs
        .closeOwnerTabs(owner, () => {
          closedCount += 1;
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HostOperationError({
                operation,
                message: `Could not close the browser tabs of this ${owner.kind === "task" ? "task" : "session"}: ${cause.message}`,
                cause,
              }),
          ),
        ),
    ).pipe(Effect.result);
    if (closedCount > 0)
      yield* addBackgroundStepDetail(
        "browser-tabs",
        `Closed ${closedCount} browser tab${closedCount === 1 ? "" : "s"}.`,
      );
    return (yield* Effect.fromResult(result)).some(Boolean);
  });
