import { type AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type {
  TaskActivityGuardPort,
  TaskActivityGuardStopResult,
  TaskActivityGuardTaskSessions,
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
      const probe = yield* runtimeRegistry.probeSessionStatus({
        runtimeKind: session.runtimeKind.trim(),
        repoPath,
        externalSessionId,
        workingDirectory: session.workingDirectory,
      });
      if (!probe.supported) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "runtimeTaskActivityGuard.probeSessionStatus",
            message: `Runtime ${session.runtimeKind} cannot check session ${externalSessionId} before task cleanup.`,
            details: {
              externalSessionId,
              role: session.role,
              runtimeKind: session.runtimeKind,
            },
          }),
        );
      }
      if (probe.hasLiveSession) {
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
              message: `Failed checking live runtime state before ${input.failureContext} (${task.taskId}): ${
                error instanceof Error ? error.message : String(error)
              }`,
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
          Effect.mapError((cause) => {
            const completedStopMessage =
              stoppedSessionCount > 0
                ? ` after stopping ${stoppedSessionCount} earlier live agent session${stoppedSessionCount === 1 ? "" : "s"}`
                : "";
            return new HostOperationError({
              operation,
              message: `Failed stopping live ${session.role} session ${session.externalSessionId}${completedStopMessage}: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
              cause,
              details: {
                externalSessionId: session.externalSessionId,
                role: session.role,
                runtimeKind: session.runtimeKind,
                stoppedSessionCount,
              },
            });
          }),
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
