import { type AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type {
  TaskActivityGuardPort,
  TaskActivityCleanupResult,
  TaskActivityGuardTaskSessions,
} from "../../ports/task-activity-guard-port";

export type CreateRuntimeTaskActivityGuardInput = {
  runtimeRegistry: RuntimeRegistryPort;
  sessionService: Pick<AgentSessionLiveStateService, "list" | "releaseSession">;
  settingsConfig: Pick<SettingsConfigPort, "pathExists">;
};

type LiveSession = {
  externalSessionId: string;
  role: string;
  runtimeKind: AgentSessionRecord["runtimeKind"];
  workingDirectory: string;
};

const collectLiveSessions = (
  runtimeRegistry: RuntimeRegistryPort,
  settingsConfig: Pick<SettingsConfigPort, "pathExists">,
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
      if (!(yield* settingsConfig.pathExists(session.workingDirectory))) {
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
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
        });
      }
    }
    return liveSessions;
  });

const collectTaskLiveSessions = (
  runtimeRegistry: RuntimeRegistryPort,
  settingsConfig: Pick<SettingsConfigPort, "pathExists">,
  input: TaskActivityGuardTaskSessions & { operation: string; failureContext: string },
) =>
  Effect.gen(function* () {
    const liveSessions: LiveSession[] = [];
    for (const task of input.taskSessions) {
      const taskLiveSessions = yield* collectLiveSessions(
        runtimeRegistry,
        settingsConfig,
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
  sessionService: Pick<AgentSessionLiveStateService, "list" | "releaseSession">,
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
      yield* sessionService
        .releaseSession({
          repoPath,
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
          externalSessionId: session.externalSessionId,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HostOperationError({
                operation,
                message: `Stopped session ${session.externalSessionId}, but failed releasing its live state: ${cause instanceof Error ? cause.message : String(cause)}`,
                cause,
                details: {
                  externalSessionId: session.externalSessionId,
                  role: session.role,
                  runtimeKind: session.runtimeKind,
                  stoppedSessionCount,
                },
              }),
          ),
        );
    }
    return stoppedSessionCount;
  });

const releaseTaskSessions = (
  sessionService: Pick<AgentSessionLiveStateService, "list" | "releaseSession">,
  input: TaskActivityGuardTaskSessions,
) =>
  Effect.gen(function* () {
    const taskSessions = input.taskSessions.flatMap((task) => task.sessions);
    const snapshots = yield* sessionService.list({ repoPath: input.repoPath });
    for (const snapshot of snapshots) {
      const isTaskSession = taskSessions.some((session) =>
        hasSameAgentSessionIdentity(session, snapshot.ref),
      );
      if (isTaskSession) {
        yield* sessionService.releaseSession(snapshot.ref);
      }
    }
  }).pipe(
    Effect.mapError(
      (cause) =>
        new HostOperationError({
          operation: "runtimeTaskActivityGuard.releaseSessions",
          message: `Failed releasing task session state: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    ),
  );

export const createRuntimeTaskActivityGuard = ({
  runtimeRegistry,
  sessionService,
  settingsConfig,
}: CreateRuntimeTaskActivityGuardInput): TaskActivityGuardPort => ({
  countLiveSessions(input) {
    return Effect.gen(function* () {
      const liveSessions = yield* collectTaskLiveSessions(runtimeRegistry, settingsConfig, {
        ...input,
        operation: "runtimeTaskActivityGuard.countLiveSessions",
        failureContext: "counting live task sessions",
      });
      return { liveSessionCount: liveSessions.length };
    });
  },
  cleanupTaskSessions(input) {
    return Effect.gen(function* () {
      const liveSessions = yield* collectTaskLiveSessions(runtimeRegistry, settingsConfig, {
        ...input,
        operation: "runtimeTaskActivityGuard.cleanupTaskSessions",
        failureContext: "cleaning up task sessions",
      });
      const stoppedSessionCount = yield* stopLiveSessionRecords(
        runtimeRegistry,
        sessionService,
        input.repoPath,
        "runtimeTaskActivityGuard.cleanupTaskSessions",
        liveSessions,
      );
      yield* releaseTaskSessions(sessionService, input);
      return { stoppedSessionCount } satisfies TaskActivityCleanupResult;
    });
  },
});
