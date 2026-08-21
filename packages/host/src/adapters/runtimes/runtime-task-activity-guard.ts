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

const collectLiveSessions = (
  runtimeRegistry: RuntimeRegistryPort,
  repoPath: string,
  sessions: AgentSessionRecord[],
  sessionRoles: string[],
) =>
  Effect.gen(function* () {
    const allowedRoles = new Set(sessionRoles.map((role) => role.trim()).filter(Boolean));
    const liveSessions: LiveSession[] = [];
    for (const session of sessions) {
      const role = session.role.trim();
      if (!allowedRoles.has(role)) {
        continue;
      }
      const externalSessionId = session.externalSessionId.trim();
      if (!externalSessionId) {
        continue;
      }
      // An unsupported probe means the runtime cannot report liveness. Treating
      // that as active blocked delete/reset forever for idle or offline
      // runtimes, so unsupported probes are ignored here.
      const probe = yield* runtimeRegistry.probeSessionStatus({
        runtimeKind: session.runtimeKind.trim(),
        repoPath,
        externalSessionId,
        workingDirectory: session.workingDirectory,
      });
      if (probe.supported && probe.hasLiveSession) {
        liveSessions.push({
          externalSessionId,
          role,
          runtimeKind: session.runtimeKind.trim(),
          workingDirectory: session.workingDirectory,
        });
      }
    }
    return liveSessions;
  });

const stopLiveSessions = (
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

const stopActiveSessionsForRoles = (
  runtimeRegistry: RuntimeRegistryPort,
  input: {
    repoPath: string;
    operation: string;
    failureContext: string;
    sessions: AgentSessionRecord[];
    sessionRoles: string[];
  },
) =>
  Effect.gen(function* () {
    const liveSessions = yield* collectLiveSessions(
      runtimeRegistry,
      input.repoPath,
      input.sessions,
      input.sessionRoles,
    ).pipe(
      Effect.mapError(
        (error) =>
          new HostOperationError({
            operation: input.operation,
            message: `Failed checking live runtime state before ${input.failureContext}`,
            cause: error,
          }),
      ),
    );
    const stoppedSessionCount = yield* stopLiveSessions(
      runtimeRegistry,
      input.repoPath,
      input.operation,
      liveSessions,
    );
    return { stoppedSessionCount } satisfies TaskActivityGuardStopResult;
  });

export const createRuntimeTaskActivityGuard = ({
  runtimeRegistry,
}: CreateRuntimeTaskActivityGuardInput): TaskActivityGuardPort => ({
  stopActiveTaskDeleteRuns(input) {
    return Effect.gen(function* () {
      let stoppedSessionCount = 0;
      for (const task of input.taskSessions) {
        const result = yield* stopActiveSessionsForRoles(runtimeRegistry, {
          repoPath: input.repoPath,
          operation: "runtimeTaskActivityGuard.stopActiveTaskDeleteRuns",
          failureContext: `deleting task ${task.taskId}`,
          sessions: task.sessions,
          sessionRoles: task.sessions.map((session) => session.role),
        });
        stoppedSessionCount += result.stoppedSessionCount;
      }
      return { stoppedSessionCount };
    });
  },
  stopActiveTaskResetActivity(input) {
    return stopActiveSessionsForRoles(runtimeRegistry, {
      repoPath: input.repoPath,
      operation: "runtimeTaskActivityGuard.stopActiveTaskResetActivity",
      failureContext: `${input.operationLabel} task ${input.taskId}`,
      sessions: input.sessions,
      sessionRoles: input.sessionRoles,
    });
  },
});
