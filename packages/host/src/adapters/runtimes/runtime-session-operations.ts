import {
  type RuntimeInstanceSummary,
  type RuntimeKind,
  type RuntimeRoute,
  runtimeKindSchema,
} from "@openducktor/contracts";
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

export type ClaudeRuntimeSessionOperationsPort =
  | {
      stopSession(input: RuntimeSessionStopInput): Effect.Effect<void, unknown>;
      probeSessionStatus(
        input: RuntimeSessionStatusProbeInput,
      ): Effect.Effect<{ supported: boolean; hasLiveSession: boolean }, unknown>;
    }
  | undefined;

export type RuntimeSessionOperations = {
  stopSession(
    input: RuntimeSessionStopInput,
    runtime: RuntimeInstanceSummary,
  ): Effect.Effect<void, RuntimeRegistryError>;
  probeSessionStatus(
    input: RuntimeSessionStatusProbeInput,
    runtime: RuntimeInstanceSummary,
  ): Effect.Effect<{ supported: boolean; hasLiveSession: boolean }, RuntimeRegistryError>;
};

export type RuntimeSessionOperationsByKind = Partial<Record<RuntimeKind, RuntimeSessionOperations>>;

export type CreateRuntimeSessionOperationsInput = {
  codexAppServer?: Pick<CodexAppServerPort, "request">;
  claudeAgentSdk?: ClaudeRuntimeSessionOperationsPort;
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
  codexAppServer: Pick<CodexAppServerPort, "request"> | undefined,
): RuntimeSessionOperations => ({
  stopSession(input, runtime) {
    return Effect.gen(function* () {
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
    });
  },
  probeSessionStatus(input, runtime) {
    return Effect.gen(function* () {
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
    });
  },
});

const createClaudeSessionOperations = (
  claudeAgentSdk: ClaudeRuntimeSessionOperationsPort,
): RuntimeSessionOperations => ({
  stopSession(input) {
    return Effect.gen(function* () {
      const sdk = yield* requireClaudeAgentSdk(
        claudeAgentSdk,
        "runtimeRegistry.stopClaudeSession",
        "Claude session stop requires the Claude Agent SDK service.",
      );
      return yield* sdk
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
    });
  },
  probeSessionStatus(input) {
    return Effect.gen(function* () {
      const sdk = yield* requireClaudeAgentSdk(
        claudeAgentSdk,
        "runtimeRegistry.probeClaudeSessionStatus",
        "Claude session status probing requires the Claude Agent SDK service.",
      );
      return yield* sdk
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
    });
  },
});

export const createRuntimeSessionOperations = ({
  codexAppServer,
  claudeAgentSdk,
}: CreateRuntimeSessionOperationsInput = {}): RuntimeSessionOperationsByKind => ({
  opencode: createOpenCodeSessionOperations(),
  codex: createCodexSessionOperations(codexAppServer),
  claude: createClaudeSessionOperations(claudeAgentSdk),
});

type StopRuntimeSessionInput = {
  input: RuntimeSessionStopInput;
  runtime: RuntimeInstanceSummary;
  sessionOperations: RuntimeSessionOperationsByKind;
};

type ProbeRuntimeSessionStatusInput = {
  input: RuntimeSessionStatusProbeInput;
  runtime: RuntimeInstanceSummary | null;
  sessionOperations: RuntimeSessionOperationsByKind;
};

const requireSessionOperations = (
  runtimeKind: string,
  sessionOperations: RuntimeSessionOperationsByKind,
  operation: string,
) => {
  const parsedRuntimeKind = runtimeKindSchema.safeParse(runtimeKind);
  if (!parsedRuntimeKind.success) {
    return Effect.fail(
      new HostValidationError({
        message: `Runtime kind ${runtimeKind} does not support ${operation} in the TypeScript host.`,
        field: "runtimeKind",
        details: { runtimeKind },
      }),
    );
  }

  const operations = sessionOperations[parsedRuntimeKind.data];
  if (operations) {
    return Effect.succeed(operations);
  }
  return Effect.fail(
    new HostValidationError({
      message: `Runtime kind ${parsedRuntimeKind.data} does not support ${operation} in the TypeScript host.`,
      field: "runtimeKind",
      details: { runtimeKind: parsedRuntimeKind.data },
    }),
  );
};

const optionalSessionOperationsFor = (
  runtimeKind: string,
  sessionOperations: RuntimeSessionOperationsByKind,
) => {
  const parsedRuntimeKind = runtimeKindSchema.safeParse(runtimeKind);
  if (!parsedRuntimeKind.success) {
    return null;
  }
  return sessionOperations[parsedRuntimeKind.data] ?? null;
};

const requireClaudeAgentSdk = (
  claudeAgentSdk: ClaudeRuntimeSessionOperationsPort,
  operation: string,
  message: string,
) => {
  if (claudeAgentSdk) {
    return Effect.succeed(claudeAgentSdk);
  }
  return Effect.fail(
    new HostResourceError({
      resource: "claudeAgentSdk",
      operation,
      message,
    }),
  );
};

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

export const stopRuntimeSession = ({
  input,
  runtime,
  sessionOperations,
}: StopRuntimeSessionInput): Effect.Effect<void, RuntimeRegistryError> =>
  Effect.gen(function* () {
    const operations = yield* requireSessionOperations(
      input.runtimeKind,
      sessionOperations,
      "session stop",
    );
    return yield* operations.stopSession(input, runtime);
  });

export const probeRuntimeSessionStatus = ({
  input,
  runtime,
  sessionOperations,
}: ProbeRuntimeSessionStatusInput): Effect.Effect<
  { supported: boolean; hasLiveSession: boolean },
  RuntimeRegistryError
> =>
  Effect.gen(function* () {
    if (!runtime) {
      return { supported: true, hasLiveSession: false };
    }
    const operations = optionalSessionOperationsFor(input.runtimeKind, sessionOperations);
    if (!operations) {
      return { supported: false, hasLiveSession: false };
    }
    return yield* operations.probeSessionStatus(input, runtime);
  });
