import type { AgentSessionScope, AgentSessionWorkflowScope } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

export const requireWorkflowAgentSessionScope = (
  scope: AgentSessionScope | undefined,
  action: string,
): Effect.Effect<AgentSessionWorkflowScope, HostValidationError<{ action: string }>> => {
  if (!scope) {
    return Effect.fail(
      new HostValidationError({
        field: "sessionScope",
        message: `Cannot ${action} without workflow session context.`,
        details: { action },
      }),
    );
  }
  if (scope.kind !== "workflow") {
    return Effect.fail(
      new HostValidationError({
        field: "sessionScope",
        message: `Cannot ${action} with ${scope.kind} session context; workflow session context is required.`,
        details: { action },
      }),
    );
  }
  return Effect.succeed(scope);
};
