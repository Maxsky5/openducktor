import type { RuntimeKind } from "@openducktor/contracts";
import {
  type AgentDeliveryAvailability,
  type AgentSessionGoalCommand,
  goalCommandBlockedReason,
  resolveRuntimeGoalAvailability,
} from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import { resolveRuntimeDescriptor } from "../runtimes/runtime-request-resolution";

/** Goal checks with the descriptor and the read version of the shared runtime of a kind. */
export type SessionGoalRules = {
  readonly availability: (
    runtimeKind: RuntimeKind,
  ) => Effect.Effect<AgentDeliveryAvailability, HostError>;
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
  const runtimeOf = (runtimeKind: RuntimeKind) =>
    Effect.all([resolveRuntimeDescriptor(definitions, runtimeKind), registry.status(runtimeKind)]);
  return {
    availability: (runtimeKind) =>
      runtimeOf(runtimeKind).pipe(
        Effect.map(([descriptor, status]) =>
          resolveRuntimeGoalAvailability(descriptor, status.version),
        ),
      ),
    blockedReason: (runtimeKind, command) =>
      runtimeOf(runtimeKind).pipe(
        Effect.map(([descriptor, status]) =>
          goalCommandBlockedReason(command, descriptor, status.version),
        ),
      ),
  };
};
