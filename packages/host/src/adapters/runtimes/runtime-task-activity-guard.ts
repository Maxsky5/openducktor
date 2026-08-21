import { type AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type {
  TaskActivityGuardPort,
  TaskActivityGuardStopResult,
} from "../../ports/task-activity-guard-port";

export type CreateRuntimeTaskActivityGuardInput = {
  runtimeRegistry: RuntimeRegistryPort;
};

type LiveSession = {
  externalSessionId: string;
  role: string;
  runtimeKind: string;
  workingDirectory: string;
};

type TaskActivityGuardTaskSessions = Parameters<TaskActivityGuardPort["stopLiveSessions"]>[0];

const collectLiveSessions = (
  runtimeRegistry: RuntimeRegistryPort,
  repoPath: string,
  sessions: AgentSessionRecord[],
) =>
  Effect.gen(function* () {
    const liveSessions: LiveSession[] = [];
    for (const session of sessions) {
      const externalSessionId = session.externalSessionId.trim();
      if (!externalSessionId) {
        continue;
      }
      // An unsupported probe means the runtime cannot report liveness. Such
      // probes must not block destructive cleanup; offline runtimes would
      // otherwise make delete and reset impossible forever.
      const probe = yield* runtimeRegistry.probeSessionStatus({
        runtimeKind: session.runtimeKind.trim(),
        repoPath,
        externalSessionId,
        workingDirectory: session.workingDirectory,
      });
      if (probe.supported && probe.hasLiveSession) {
        liveSessions.push({
          externalSessionId,
          role: session.role.trim(),
          runtimeKind: session.runtimeKind.trim(),
          workingDirectory: session.workingDirectory,
        });
      }
    }
    return liveSessions;
  });

const collectTaskLiveSessions = (
  runtimeRegistry: RuntimeRegistryPort,
  input: TaskActivityGuardTaskSessions & { operation: string; failureContext: string },
) =>
  Effect.gen(function* () {
    const liveSessions: LiveSession[] = [];
    for (const task of input.taskSessions) {
      const taskLiveSessions = yield* collectLiveSessions(
        runtimeRegistry,
        input.repoPath,
        task.sessions,
      ).pipe(
        Effect.mapError(
          (error) =>
            new HostOperationError({
              operation: input.operation,
              message: `Failed checking live runtime state before ${input.failureContext} (${task.taskId})`,
              cause: error,
            }),
        ),
      );
      liveSessions.push(...taskLiveSessions);
    }
    return liveSessions;
  });

const stopLiveSessionRecords = (
  runtimeRegistry: RuntimeRegistryPort,
  repoPath: string,
  operation: string,
  liveSessions: LiveSession[],
) =>
  Effect.gen(function* () {
    let stoppedSessionCount = 0;
    for (const session of liveSessions) {
      yield* runtimeRegistry
        .stopSession({
          runtimeKind: session.runtimeKind,
          repoPath,
          externalSessionId: session.externalSessionId,
          workingDirectory: session.workingDirectory,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HostOperationError({
                operation,
                message: `Failed stopping live ${session.role} session ${session.externalSessionId}: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
                cause,
                details: {
                  externalSessionId: session.externalSessionId,
                  role: session.role,
                  runtimeKind: session.runtimeKind,
                },
              }),
          ),
        );
      stoppedSessionCount += 1;
    }
    return stoppedSessionCount;
  });

export const createRuntimeTaskActivityGuard = ({
  runtimeRegistry,
}: CreateRuntimeTaskActivityGuardInput): TaskActivityGuardPort => ({
  countLiveSessions(input) {
    return Effect.gen(function* () {
      const liveSessions = yield* collectTaskLiveSessions(runtimeRegistry, {
        ...input,
        operation: "runtimeTaskActivityGuard.countLiveSessions",
        failureContext: "counting live task sessions",
      });
      return { liveSessionCount: liveSessions.length };
    });
  },
  stopLiveSessions(input) {
    return Effect.gen(function* () {
      const liveSessions = yield* collectTaskLiveSessions(runtimeRegistry, {
        ...input,
        operation: "runtimeTaskActivityGuard.stopLiveSessions",
        failureContext: "stopping live task sessions",
      });
      const stoppedSessionCount = yield* stopLiveSessionRecords(
        runtimeRegistry,
        input.repoPath,
        "runtimeTaskActivityGuard.stopLiveSessions",
        liveSessions,
      );
      return { stoppedSessionCount } satisfies TaskActivityGuardStopResult;
    });
  },
});
