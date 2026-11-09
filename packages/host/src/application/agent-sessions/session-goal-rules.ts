import type { RuntimeKind } from "@openducktor/contracts";
import { type AgentSessionGoalCommand, goalCommandBlockedReason } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import { resolveRuntimeDescriptor } from "../runtimes/runtime-request-resolution";

/** Goal checks with the descriptor and the read version of the shared runtime of a kind. */
export type SessionGoalRules = {
  readonly blockedReason: (
    runtimeKind: RuntimeKind,
    command: AgentSessionGoalCommand,
  ) => Effect.Effect<string | null, HostError>;
};

export const createSessionGoalRules = ({
  definitions,
  registry,
}: {
  readonly definitions: RuntimeDefinitionsService;
  readonly registry: Pick<RuntimeRegistryPort, "status">;
}): SessionGoalRules => {
  return {
    blockedReason: (runtimeKind, command) =>
      Effect.all([
        resolveRuntimeDescriptor(definitions, runtimeKind),
        registry.status(runtimeKind),
      ]).pipe(
        Effect.map(([descriptor, status]) =>
          goalCommandBlockedReason(command, descriptor, status.version),
        ),
      ),
  };
};
