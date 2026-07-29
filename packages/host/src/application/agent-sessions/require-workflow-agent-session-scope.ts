import type { AgentSessionScope, AgentSessionWorkflowScope } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

export const requireWorkflowAgentSessionScope = (
  scope: AgentSessionScope | undefined,
  action: string,
): Effect.Effect<AgentSessionWorkflowScope, HostValidationError> =>
  Effect.try({
    try: () => {
      if (!scope) {
        throw new Error(`Cannot ${action} without workflow session context.`);
      }
      if (scope.kind !== "workflow") {
        throw new Error(
          `Cannot ${action} with ${scope.kind} session context; workflow session context is required.`,
        );
      }
      return scope;
    },
    catch: (cause) =>
      new HostValidationError({
        field: "sessionScope",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { action },
      }),
  });
