import {
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  type AgentSessionRecord,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { resolveOwnedSessionRoot } from "../agent-sessions/session-owner-resolution";
import { Effect } from "effect";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
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
  readSessionRootRefs: (
    repoPath: string,
  ) => Effect.Effect<
    import("@openducktor/contracts").AgentSessionAuthorizedRoot[],
    import("../../effect/host-errors").HostError
  >;
};

type LiveSession = {
  externalSessionId: string;
  role: string;
  runtimeKind: AgentSessionRecord["runtimeKind"];
  workingDirectory: string;
};

const collectLiveSessions = (
  runtimeRegistry: RuntimeRegistryPort,
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
        runtimeKind: session.runtimeKind,
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
  input: TaskActivityGuardTaskSessions & { operation: string; failureContext: string },
) =>
  Effect.gen(function* () {
    const liveSessions: LiveSession[] = [];
    for (const task of input.taskSessions) {
      const taskLiveSessions = yield* collectLiveSessions(runtimeRegistry, task.sessions).pipe(
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

const childrenFirst = (
  liveSessions: LiveSession[],
  snapshots: AgentSessionLiveSnapshot[],
  repoPath: string,
) => {
  const live = new Map(
    liveSessions.map((session) => [agentSessionRefKey({ repoPath, ...session }), session]),
  );
  const children = new Map<string, AgentSessionLiveRef[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.parentExternalSessionId) continue;
    const parentKey = agentSessionRefKey({
      ...snapshot.ref,
      externalSessionId: snapshot.parentExternalSessionId,
    });
    const siblings = children.get(parentKey) ?? [];
    siblings.push(snapshot.ref);
    children.set(parentKey, siblings);
  }
  const visited = new Set<string>();
  const ordered: LiveSession[] = [];
  const visit = (ref: AgentSessionLiveRef) => {
    const key = agentSessionRefKey(ref);
    if (visited.has(key)) return;
    visited.add(key);
    for (const child of children.get(key) ?? []) visit(child);
    const session = live.get(key);
    if (session) ordered.push(session);
  };
  for (const session of liveSessions) visit({ repoPath, ...session });
  return ordered;
};

export const createRuntimeTaskActivityGuard = ({
  runtimeRegistry,
  sessionService,
  readSessionRootRefs,
}: CreateRuntimeTaskActivityGuardInput): TaskActivityGuardPort => {
  const collectOwnedSessions = (input: TaskActivityGuardTaskSessions, operation: string) =>
    Effect.gen(function* () {
      const liveSessions = yield* collectTaskLiveSessions(runtimeRegistry, {
        ...input,
        operation,
        failureContext: "checking task sessions",
      });
      const roots = yield* readSessionRootRefs(input.repoPath);
      const sessions = yield* sessionService.list({ repoPath: input.repoPath });
      const affected = new Set(
        input.taskSessions.flatMap((task) =>
          task.sessions.map((session) =>
            agentSessionRefKey({ repoPath: input.repoPath, ...session }),
          ),
        ),
      );
      const probed = new Set(affected);
      const ownedSnapshots: AgentSessionLiveSnapshot[] = [];
      for (const session of sessions) {
        if (
          !input.taskSessions.some((task) =>
            task.sessions.some(
              (record) =>
                record.runtimeKind === session.ref.runtimeKind &&
                record.workingDirectory === session.ref.workingDirectory,
            ),
          )
        )
          continue;
        const root = yield* resolveOwnedSessionRoot({ ref: session.ref, roots, sessions });
        if (!affected.has(agentSessionRefKey(root))) continue;
        ownedSnapshots.push(session);
        if (session.statusUnavailableReason)
          return yield* new HostOperationError({
            operation,
            message: `Cannot establish safe activity for linked session ${session.ref.externalSessionId}: ${session.statusUnavailableReason}`,
          });
        const key = agentSessionRefKey(session.ref);
        if (probed.has(key)) continue;
        probed.add(key);
        const probe = yield* runtimeRegistry.probeSessionStatus({
          runtimeKind: session.ref.runtimeKind,
          externalSessionId: session.ref.externalSessionId,
          workingDirectory: session.ref.workingDirectory,
        });
        if (!probe.supported)
          return yield* new HostOperationError({
            operation,
            message: `The runtime cannot check linked child session ${session.ref.externalSessionId}. Stop its owned session tree before completion.`,
          });
        if (probe.hasLiveSession) {
          liveSessions.push({
            ...session.ref,
            role: root.sessionScope.kind === "workflow" ? root.sessionScope.role : "repository",
          });
        }
      }
      return { liveSessions, ownedSnapshots };
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation,
            message: cause.message,
            cause,
          }),
      ),
    );
  return {
    countLiveSessions(input) {
      return collectOwnedSessions(input, "runtimeTaskActivityGuard.countLiveSessions").pipe(
        Effect.map(({ liveSessions }) => ({ liveSessionCount: liveSessions.length })),
      );
    },
    cleanupTaskSessions(input) {
      return Effect.gen(function* () {
        const operation = "runtimeTaskActivityGuard.cleanupTaskSessions";
        const { liveSessions, ownedSnapshots } = yield* collectOwnedSessions(input, operation);
        const stoppedSessionCount = yield* stopLiveSessionRecords(
          runtimeRegistry,
          sessionService,
          input.repoPath,
          operation,
          childrenFirst(liveSessions, ownedSnapshots, input.repoPath),
        );
        const stopped = new Set(
          liveSessions.map((session) =>
            agentSessionRefKey({ repoPath: input.repoPath, ...session }),
          ),
        );
        for (const snapshot of ownedSnapshots) {
          if (!stopped.has(agentSessionRefKey(snapshot.ref)))
            yield* sessionService.releaseSession(snapshot.ref).pipe(
              Effect.mapError(
                (cause) =>
                  new HostOperationError({
                    operation,
                    message: `Failed releasing task session state: ${cause.message}`,
                    cause,
                  }),
              ),
            );
        }
        return { stoppedSessionCount } satisfies TaskActivityCleanupResult;
      });
    },
  };
};
