import type { RuntimeInstanceSummary, RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";
import type {
  RuntimeRegistryError,
  RuntimeSessionStatusProbeInput,
  RuntimeSessionStopInput,
} from "../../ports/runtime-registry-port";
import { probeCodexSessionStatus } from "../codex/codex-session-status-probe";
import { stopCodexSession } from "../codex/codex-session-stop";
import { probeOpenCodeSessionStatus, stopOpenCodeSession } from "./runtime-registry-probes";

type RuntimeSessionOperationDeps = {
  codexAppServer: Pick<CodexAppServerPort, "request"> | undefined;
};

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

const toSessionRouteTarget = (
  input: RuntimeSessionStopInput | RuntimeSessionStatusProbeInput,
  runtime: RuntimeInstanceSummary,
) => ({
  runtimeKind: input.runtimeKind,
  runtimeRoute: runtime.runtimeRoute,
  externalSessionId: input.externalSessionId,
  workingDirectory: input.workingDirectory,
});

const requireCodexAppServer = (
  codexAppServer: Pick<CodexAppServerPort, "request"> | undefined,
  operation: string,
  message: string,
) => {
  if (codexAppServer) {
    return Effect.succeed(codexAppServer);
  }
  return Effect.fail(
    new HostResourceError({
      resource: "codexAppServer",
      operation,
      message,
    }),
  );
};

export const stopRuntimeSession = ({
  input,
  runtime,
  codexAppServer,
}: RuntimeSessionOperationDeps & {
  input: RuntimeSessionStopInput;
  runtime: RuntimeInstanceSummary;
}): Effect.Effect<void, RuntimeRegistryError> =>
  Effect.gen(function* () {
    if (input.runtimeKind === "opencode") {
      return yield* stopOpenCodeSession(toSessionRouteTarget(input, runtime));
    }
    if (input.runtimeKind === "codex") {
      const appServer = yield* requireCodexAppServer(
        codexAppServer,
        "runtimeRegistry.stopCodexSession",
        "Codex session stop requires the Codex app-server port.",
      );
      const runtimeId = yield* requireCodexRuntimeId(runtime.runtimeRoute);
      return yield* stopCodexSession({
        codexAppServer: appServer,
        runtimeId,
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      });
    }
    return yield* Effect.fail(
      new HostValidationError({
        message: `Runtime kind ${input.runtimeKind} does not support session stop in the TypeScript host.`,
        field: "runtimeKind",
        details: { runtimeKind: input.runtimeKind },
      }),
    );
  });

export const probeRuntimeSessionStatus = ({
  input,
  runtime,
  codexAppServer,
}: RuntimeSessionOperationDeps & {
  input: RuntimeSessionStatusProbeInput;
  runtime: RuntimeInstanceSummary | null;
}): Effect.Effect<{ supported: boolean; hasLiveSession: boolean }, RuntimeRegistryError> =>
  Effect.gen(function* () {
    if (!runtime) {
      return { supported: true, hasLiveSession: false };
    }
    if (input.runtimeKind === "opencode") {
      return yield* probeOpenCodeSessionStatus(toSessionRouteTarget(input, runtime));
    }
    if (input.runtimeKind === "codex") {
      const appServer = yield* requireCodexAppServer(
        codexAppServer,
        "runtimeRegistry.probeSessionStatus",
        "Codex session status probing requires the Codex app-server port.",
      );
      const runtimeId = yield* requireCodexRuntimeId(runtime.runtimeRoute);
      return yield* probeCodexSessionStatus({
        codexAppServer: appServer,
        runtimeId,
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      });
    }
    return { supported: false, hasLiveSession: false };
  });
