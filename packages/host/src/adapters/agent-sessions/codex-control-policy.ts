import type { AgentSessionScope } from "@openducktor/contracts";
import type { AgentRuntimePolicyBinding } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { CreateCodexLiveSessionAdapterPreparerInput } from "./codex-live-session-adapter-contract";

export const createCodexControlPolicyBinder =
  (
    runtimeId: string,
    resolveRuntimePolicy: CreateCodexLiveSessionAdapterPreparerInput["resolveRuntimePolicy"],
  ) =>
  <Input extends { readonly runtimeKind: string; readonly sessionScope?: AgentSessionScope }>(
    input: Input,
    operation: string,
  ) => {
    if (input.runtimeKind !== "codex") {
      return Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Codex live-session control '${operation}' requires a Codex runtime.`,
          details: { operation, runtimeKind: input.runtimeKind },
        }),
      );
    }
    const sessionScope = input.sessionScope;
    if (!sessionScope) {
      return Effect.fail(
        new HostValidationError({
          field: "sessionScope",
          message: `Codex live-session control '${operation}' requires session scope.`,
          details: { operation, runtimeId },
        }),
      );
    }
    return resolveRuntimePolicy(sessionScope).pipe(
      Effect.map((policy) => {
        const binding: Extract<AgentRuntimePolicyBinding, { runtimeKind: "codex" }> = {
          runtimeKind: "codex",
          runtimePolicy: { kind: "codex", policy },
        };
        return { ...input, ...binding, sessionScope };
      }),
    );
  };
