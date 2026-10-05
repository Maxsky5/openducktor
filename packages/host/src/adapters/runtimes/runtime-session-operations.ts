import {
  type RuntimeInstanceSummary,
  type RuntimeKind,
  type RuntimeRoute,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";
import type { RuntimeRegistryError, RuntimeSessionTarget } from "../../ports/runtime-registry-port";
import { probeCodexSessionStatus } from "../codex/codex-session-status-probe";
import { stopCodexSession } from "../codex/codex-session-stop";
import { probeOpenCodeSessionStatus, stopOpenCodeSession } from "./runtime-registry-probes";

export type ClaudeRuntimeSessionOperationsPort = {
  stopSession(input: RuntimeSessionTarget): Effect.Effect<void, unknown>;
  probeSessionStatus(
    input: RuntimeSessionTarget,
  ): Effect.Effect<{ supported: boolean; hasLiveSession: boolean }, unknown>;
};

export type RuntimeSessionOperations = {
  stopSession(
    input: RuntimeSessionTarget,
    runtime: RuntimeInstanceSummary,
  ): Effect.Effect<void, RuntimeRegistryError>;
  probeSessionStatus(
    input: RuntimeSessionTarget,
    runtime: RuntimeInstanceSummary,
  ): Effect.Effect<{ supported: boolean; hasLiveSession: boolean }, RuntimeRegistryError>;
};

export type RuntimeSessionOperationsByKind = Record<RuntimeKind, RuntimeSessionOperations>;

export type CreateRuntimeSessionOperationsInput = {
  codexAppServer: Pick<CodexAppServerPort, "request">;
  claudeAgentSdk: ClaudeRuntimeSessionOperationsPort;
};

const toClaudeSessionOperationError = (
  resource: string,
  operation: string,
  cause: unknown,
): HostResourceError =>
  new HostResourceError({
    resource,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const createOpenCodeSessionOperations = (): RuntimeSessionOperations => ({
  stopSession(input, runtime) {
    return stopOpenCodeSession(toSessionRouteTarget(input, runtime));
  },
  probeSessionStatus(input, runtime) {
    return probeOpenCodeSessionStatus(toSessionRouteTarget(input, runtime));
  },
});

const createCodexSessionOperations = (
  codexAppServer: Pick<CodexAppServerPort, "request">,
): RuntimeSessionOperations => ({
  stopSession(input, runtime) {
    return Effect.gen(function* () {
      const runtimeId = yield* requireCodexRuntimeId(runtime.runtimeRoute);
      return yield* stopCodexSession({
        codexAppServer,
        runtimeId,
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      });
    });
  },
  probeSessionStatus(input, runtime) {
    return Effect.gen(function* () {
      const runtimeId = yield* requireCodexRuntimeId(runtime.runtimeRoute);
      return yield* probeCodexSessionStatus({
        codexAppServer,
        runtimeId,
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      });
    });
  },
});

const createClaudeSessionOperations = (
  claudeAgentSdk: ClaudeRuntimeSessionOperationsPort,
): RuntimeSessionOperations => ({
  stopSession(input) {
    return claudeAgentSdk
      .stopSession(input)
      .pipe(
        Effect.mapError((cause) =>
          toClaudeSessionOperationError(
            "claudeAgentSdk",
            "runtimeRegistry.stopClaudeSession",
            cause,
          ),
        ),
      );
  },
  probeSessionStatus(input) {
    return claudeAgentSdk
      .probeSessionStatus(input)
      .pipe(
        Effect.mapError((cause) =>
          toClaudeSessionOperationError(
            "claudeAgentSdk",
            "runtimeRegistry.probeClaudeSessionStatus",
            cause,
          ),
        ),
      );
  },
});

export const createRuntimeSessionOperations = ({
  codexAppServer,
  claudeAgentSdk,
}: CreateRuntimeSessionOperationsInput) =>
  ({
    opencode: createOpenCodeSessionOperations(),
    codex: createCodexSessionOperations(codexAppServer),
    claude: createClaudeSessionOperations(claudeAgentSdk),
  }) satisfies RuntimeSessionOperationsByKind;

const requireCodexRuntimeId = (runtimeRoute: RuntimeRoute) =>
  Effect.gen(function* () {
    if (runtimeRoute.type === "stdio") {
      return runtimeRoute.identity;
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "runtimeRoute",
        message: "Codex app-server operations require a stdio runtime route.",
        details: { runtimeRouteType: runtimeRoute.type },
      }),
    );
  });

const toSessionRouteTarget = (input: RuntimeSessionTarget, runtime: RuntimeInstanceSummary) => ({
  runtimeKind: input.runtimeKind,
  runtimeRoute: runtime.runtimeRoute,
  externalSessionId: input.externalSessionId,
  workingDirectory: input.workingDirectory,
});
