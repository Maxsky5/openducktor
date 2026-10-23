import type { BrowserTabOwner } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  ManagedCallerResolver,
  ManagedCallerResolverError,
  ManagedCallerResolverInput,
} from "../agent-sessions/managed-caller-resolver";
import { BrowserServiceError } from "./browser-service-error";

export type BrowserCallerResolverInput = ManagedCallerResolverInput;
export type BrowserCallerResolverError = BrowserServiceError | ManagedCallerResolverError;

/** Finds the task or Workspace Session of a browser tool call from the runtime session. */
export type BrowserCallerResolver = {
  resolve(
    input: BrowserCallerResolverInput,
  ): Effect.Effect<BrowserTabOwner, BrowserCallerResolverError>;
};

export const createBrowserCallerResolver = (
  managedCallers: ManagedCallerResolver,
): BrowserCallerResolver => ({
  resolve: (input) =>
    managedCallers.resolve(input).pipe(
      Effect.map((owner): BrowserTabOwner =>
        owner.kind === "task"
          ? { kind: "task", workspaceId: input.workspaceId, taskId: owner.taskId }
          : {
              kind: "workspace_session",
              workspaceId: input.workspaceId,
              sessionId: owner.sessionId,
            },
      ),
      Effect.mapError((error) =>
        error._tag === "HostValidationError" && error.field === "caller"
          ? new BrowserServiceError({
              code: "browser_unmanaged_caller",
              operation: "browser.resolveCaller",
              message: `Browser tools need a managed OpenDucktor session. ${error.message}`,
              details: {
                runtime: input.caller.runtime,
                runtimeSessionId: input.caller.runtimeSessionId,
              },
            })
          : error,
      ),
    ),
});
