import type { AgentMessageTarget } from "@openducktor/contracts";
import { agentSessionRefKey, agentSessionScopesEqual } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";
import type { createSessionOperationOwner } from "./session-operation-owner";
import type { createSessionTurnPreparation } from "./session-turn-preparation";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";

export const createSessionCreationPreparation = ({
  runtime,
  turnPreparation,
  resolveRoot,
  policyFor,
}: {
  runtime: Pick<AgentSessionLiveStateService, "startSession" | "forkSession">;
  turnPreparation: ReturnType<typeof createSessionTurnPreparation>;
  resolveRoot: ReturnType<typeof createSessionOperationOwner>["root"];
  policyFor: (scope: AgentMessageTarget["sessionScope"]) => AgentSessionOperationPolicy;
}): Pick<AgentSessionLiveStateService, "startSession" | "forkSession"> => ({
  startSession: (input) =>
    Effect.gen(function* () {
      if (!input.workingDirectory)
        return yield* new HostValidationError({
          field: "workingDirectory",
          message: "The host must prepare a checkout before starting a session.",
        });
      const target = {
        ...input,
        workingDirectory: input.workingDirectory,
      };
      yield* turnPreparation.model(
        target,
        input.model
          ? { ...input.model, runtimeKind: input.model.runtimeKind ?? input.runtimeKind }
          : null,
      );
      const systemPrompt = yield* turnPreparation.context(target);
      const prepared = { ...input };
      if (systemPrompt !== undefined) prepared.systemPrompt = systemPrompt;
      return yield* runtime.startSession(prepared);
    }),
  forkSession: (input) =>
    Effect.gen(function* () {
      if (!input.workingDirectory)
        return yield* new HostValidationError({
          field: "workingDirectory",
          message: "Select the owned checkout before forking a session.",
        });
      const source = {
        ...input,
        workingDirectory: input.sourceWorkingDirectory ?? input.workingDirectory,
        externalSessionId: input.parentExternalSessionId,
      };
      const root = yield* resolveRoot(source);
      const sameTask =
        root.sessionScope.kind === "workflow" &&
        input.sessionScope.kind === "workflow" &&
        root.sessionScope.taskId === input.sessionScope.taskId;
      const scopeMatches = agentSessionScopesEqual(root.sessionScope, input.sessionScope);
      const sourceMatches = agentSessionRefKey(root) === agentSessionRefKey(source);
      if (input.forkPoint ? !sourceMatches || !scopeMatches : !sameTask && !scopeMatches)
        return yield* new HostValidationError({
          field: "sessionScope",
          message: "The fork parent belongs to another task or workspace chat.",
        });
      const destination = { ...source, workingDirectory: input.workingDirectory };
      yield* turnPreparation.model(
        destination,
        input.model
          ? { ...input.model, runtimeKind: input.model.runtimeKind ?? input.runtimeKind }
          : null,
      );
      const sourceSettings = yield* policyFor(root.sessionScope).prepareForkSource(source);
      const systemPrompt = yield* turnPreparation.context(destination);
      const prepared = { ...input };
      if (root.sessionScope.kind === "repository") {
        if (sourceSettings.systemPrompt === undefined)
          return yield* new HostValidationError({
            field: "sessionScope",
            message:
              "The saved workspace role context is unavailable. Reopen the saved chat before forking.",
          });
        prepared.systemPrompt = sourceSettings.systemPrompt;
      } else if (systemPrompt !== undefined) prepared.systemPrompt = systemPrompt;
      return yield* runtime.forkSession(prepared);
    }),
});
