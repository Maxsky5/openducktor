import {
  type WorkspaceSession,
  type WorkspaceSessionArchiveInput,
  type AgentSessionModelSelection,
  type AgentSessionControlStartInput,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionCreateResult,
  type WorkspaceSessionStartResult,
  type WorkspaceSessionRefInput,
  workspaceSessionCreateInputSchema,
  workspaceSessionRenameInputSchema,
} from "@openducktor/contracts";
import { Cause, Clock, Effect, Exit } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { RuntimeOrchestratorService } from "../runtimes/runtime-orchestrator-service";
import type { WorkspaceSettingsService } from "./workspace-settings-model";
import type { WorkspaceOwnershipLock } from "./workspace-ownership-lock";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import {
  validateWorkspaceSessionTarget,
  withWorkspaceSessionTarget,
  type WorkspaceSessionTargetDependencies,
} from "./workspace-session-target";
import {
  readWorkspaceSessionArchivePreview,
  removeWorkspaceSessionWorktree,
  withRestoredWorkspaceSessionWorktree,
} from "./workspace-session-worktree-lifecycle";

export type WorkspaceSessionServiceDependencies = WorkspaceSessionTargetDependencies & {
  operationGate: ReturnType<typeof createWorkspaceSessionOperationGate>;
  store: WorkspaceSessionStorePort;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "listCustomAgentRoles">;
  runtime: Pick<RuntimeOrchestratorService, "runtimeEnsure">;
  live: Pick<
    AgentSessionLiveStateService,
    "startSession" | "releaseSession" | "read" | "stopSession"
  >;
  ownershipLock: WorkspaceOwnershipLock;
};

export const createWorkspaceSessionService = (
  dependencies: WorkspaceSessionServiceDependencies,
) => {
  const { store, settings, live, runtime, git, operationGate } = dependencies;
  const scopeFor = (workspaceId: string) =>
    Effect.gen(function* () {
      const config = yield* settings.getRepoConfig(workspaceId);
      const repoPath = yield* git.canonicalizePath(config.repoPath);
      return { workspaceId, repoPath };
    });
  const recordFor = (input: WorkspaceSessionRefInput) =>
    Effect.gen(function* () {
      const scope = yield* scopeFor(input.workspaceId);
      const ref = { ...scope, sessionId: input.sessionId };
      const session = yield* store.get(ref);
      return { ref, session };
    });
  const withMutationAdmission = <A, E, R>(workspaceId: string, effect: Effect.Effect<A, E, R>) =>
    settings
      .getRepoConfig(workspaceId)
      .pipe(Effect.flatMap((config) => dependencies.withWorkStartLease(config.repoPath, effect)));
  const withWorktreeMutationAdmission = <A, E, R>(
    workspaceId: string,
    effect: Effect.Effect<A, E, R>,
  ) => dependencies.ownershipLock.runExclusive(withMutationAdmission(workspaceId, effect));
  const withArchiveAdmission = <A, E, R>(
    input: WorkspaceSessionArchiveInput,
    effect: Effect.Effect<A, E, R>,
  ) => {
    const admitted = withMutationAdmission(input.workspaceId, effect);
    return input.removeWorktree ? dependencies.ownershipLock.runExclusive(admitted) : admitted;
  };
  return {
    listActive: (workspaceId: string) =>
      scopeFor(workspaceId).pipe(Effect.flatMap(store.listActive)),
    listArchived: (workspaceId: string) =>
      scopeFor(workspaceId).pipe(Effect.flatMap(store.listArchived)),
    get: (input: WorkspaceSessionRefInput) =>
      recordFor(input).pipe(Effect.map(({ session }) => session)),
    create: (rawInput: WorkspaceSessionCreateInput) =>
      Effect.gen(function* () {
        const input = yield* Effect.try({
          try: () => workspaceSessionCreateInputSchema.parse(rawInput),
          catch: (cause) =>
            new HostValidationError({
              message: "Invalid Workspace Session creation input.",
              cause,
            }),
        });
        const manualTitle = yield* Effect.try({
          try: () =>
            workspaceSessionRenameInputSchema.shape.manualTitle.parse(input.manualTitle) || null,
          catch: (cause) =>
            new HostValidationError({
              message: "Workspace Session title must be at most 120 characters.",
              field: "manualTitle",
              cause,
            }),
        });
        const sessionId = crypto.randomUUID();
        const config = yield* settings.getRepoConfig(input.workspaceId);
        const creation = dependencies.withWorkStartLease(
          config.repoPath,
          Effect.gen(function* () {
            const roles =
              input.customAgentRoleId === null ? [] : yield* settings.listCustomAgentRoles();
            const role = roles.find((candidate) => candidate.id === input.customAgentRoleId);
            if (input.customAgentRoleId !== null && !role) {
              return yield* Effect.fail(
                new HostResourceError({
                  resource: input.customAgentRoleId,
                  operation: "workspaceSession.create",
                  message:
                    "The selected Custom Agent Role no longer exists. Select another Role or No Role.",
                }),
              );
            }
            const roleSnapshot = role ? { ...role } : null;
            const repoPath = yield* git.canonicalizePath(config.repoPath);
            return yield* withWorkspaceSessionTarget(
              dependencies,
              {
                worktree: input.worktree,
                repoConfig: { ...config, repoPath },
                location: input.location,
              },
              (executionTarget, retainTarget) =>
                Effect.gen(function* () {
                  const now = yield* Clock.currentTimeMillis;
                  const session: WorkspaceSession = {
                    id: sessionId,
                    runtimeKind: input.runtimeKind,
                    externalSessionId: null,
                    executionTarget,
                    roleSnapshot,
                    selectedModel: input.selectedModel,
                    generatedTitle: null,
                    manualTitle,
                    createdAt: now,
                    updatedAt: now,
                    archivedAt: null,
                  };
                  const saved = yield* store.create({
                    workspaceId: input.workspaceId,
                    repoPath,
                    session,
                  });
                  retainTarget();
                  return { session: saved } satisfies WorkspaceSessionCreateResult;
                }),
            );
          }),
        );
        return yield* input.location === "local_worktree"
          ? dependencies.ownershipLock.runExclusive(creation)
          : creation;
      }),
    start: (input: WorkspaceSessionRefInput) =>
      operationGate.run(
        input,
        Effect.gen(function* () {
          const { ref, session } = yield* recordFor(input);
          if (session.archivedAt !== null) {
            return yield* new HostValidationError({
              field: "sessionId",
              message: "Restore this Workspace Session before sending a message.",
            });
          }
          if (session.externalSessionId !== null) {
            return { session, runtimeSession: null } satisfies WorkspaceSessionStartResult;
          }
          yield* validateWorkspaceSessionTarget(
            dependencies,
            ref.repoPath,
            session.executionTarget,
          );
          yield* runtime.runtimeEnsure({
            repoPath: ref.repoPath,
            runtimeKind: session.runtimeKind,
          });
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const startInput: AgentSessionControlStartInput = {
                repoPath: ref.repoPath,
                runtimeKind: session.runtimeKind,
                workingDirectory: session.executionTarget.workingDirectory,
                sessionScope: { kind: "repository" },
                systemPrompt: session.roleSnapshot?.systemPrompt ?? "",
              };
              if (session.selectedModel !== null) startInput.model = session.selectedModel;
              const runtimeSession = yield* live.startSession(startInput);
              const saved = yield* Effect.exit(
                Effect.gen(function* () {
                  if (
                    runtimeSession.runtimeKind !== session.runtimeKind ||
                    runtimeSession.workingDirectory !== session.executionTarget.workingDirectory
                  ) {
                    return yield* new HostValidationError({
                      field: "runtimeSession",
                      message:
                        "Runtime returned a different Workspace Session identity or directory.",
                    });
                  }
                  return yield* store.bindRuntimeSession({
                    ...ref,
                    externalSessionId: runtimeSession.externalSessionId,
                  });
                }),
              );
              if (Exit.isSuccess(saved))
                return {
                  session: saved.value,
                  runtimeSession,
                } satisfies WorkspaceSessionStartResult;
              const released = yield* Effect.exit(
                live.releaseSession({
                  repoPath: ref.repoPath,
                  runtimeKind: runtimeSession.runtimeKind,
                  externalSessionId: runtimeSession.externalSessionId,
                  workingDirectory: runtimeSession.workingDirectory,
                }),
              );
              const releaseMessage = Exit.isFailure(released)
                ? `\nLocal runtime release also failed: ${Cause.pretty(released.cause)}`
                : "";
              return yield* new HostOperationError({
                operation: "workspaceSession.start.persist",
                message: `Workspace Session start failed: ${Cause.pretty(saved.cause)}\nRuntime history ${runtimeSession.externalSessionId} was retained.${releaseMessage}`,
                cause: { save: saved.cause, release: released },
              });
            }),
          );
        }).pipe((effect) => withMutationAdmission(input.workspaceId, effect)),
      ),
    setDraftModel: (
      input: WorkspaceSessionRefInput & { selectedModel: AgentSessionModelSelection },
    ) =>
      operationGate.run(
        input,
        withMutationAdmission(
          input.workspaceId,
          Effect.gen(function* () {
            const { ref, session } = yield* recordFor(input);
            if (session.externalSessionId !== null || session.archivedAt !== null) {
              return yield* new HostValidationError({
                field: "sessionId",
                message: "Only an active draft can change its saved model.",
              });
            }
            return yield* store.setSelectedModel({ ...ref, selectedModel: input.selectedModel });
          }),
        ),
      ),
    rename: (input: WorkspaceSessionRefInput & { manualTitle: string | null }) =>
      withMutationAdmission(
        input.workspaceId,
        Effect.gen(function* () {
          const { ref, session } = yield* recordFor(input);
          if (session.archivedAt !== null)
            return yield* Effect.fail(
              new HostValidationError({
                message: "Restore this Workspace Session before renaming it.",
                field: "sessionId",
              }),
            );
          return yield* store.rename({ ...ref, manualTitle: input.manualTitle });
        }),
      ),
    archivePreview: (input: WorkspaceSessionRefInput) =>
      Effect.gen(function* () {
        const { ref, session } = yield* recordFor(input);
        if (session.executionTarget.kind !== "local_worktree") {
          return yield* new HostValidationError({
            field: "sessionId",
            message: "This Workspace Session does not have a worktree.",
          });
        }
        const config = yield* settings.getRepoConfig(input.workspaceId);
        return yield* readWorkspaceSessionArchivePreview(
          dependencies,
          { ...config, repoPath: ref.repoPath },
          session.executionTarget,
        );
      }),
    archive: (input: WorkspaceSessionArchiveInput) =>
      operationGate.run(
        input,
        withArchiveAdmission(
          input,
          Effect.gen(function* () {
            const { ref, session } = yield* recordFor(input);
            if (session.archivedAt !== null) return session;
            const target = session.executionTarget;
            if (input.removeWorktree) {
              if (target.kind !== "local_worktree") {
                return yield* new HostValidationError({
                  field: "removeWorktree",
                  message: "Cannot remove a repository checkout when archiving a chat.",
                });
              }
              const config = yield* settings.getRepoConfig(input.workspaceId);
              const preview = yield* readWorkspaceSessionArchivePreview(
                dependencies,
                { ...config, repoPath: ref.repoPath },
                target,
              );
              if (preview.worktreeExists) {
                yield* dependencies.withWorkStartLease(
                  ref.repoPath,
                  Effect.void,
                  target.workingDirectory,
                );
              }
            } else if (session.externalSessionId !== null) {
              yield* validateWorkspaceSessionTarget(dependencies, ref.repoPath, target);
            }
            if (session.externalSessionId !== null) {
              const runtimeRef = {
                repoPath: ref.repoPath,
                runtimeKind: session.runtimeKind,
                externalSessionId: session.externalSessionId,
                workingDirectory: target.workingDirectory,
              };
              const observed = yield* live.read(runtimeRef);
              if (observed.type === "live" && observed.session.activity !== "idle") {
                if (!input.confirmStop)
                  return yield* new HostValidationError({
                    message: "This Workspace Session is running. Confirm Stop before archiving it.",
                    field: "confirmStop",
                  });
                yield* live.stopSession(runtimeRef);
              }
            }
            return yield* Effect.uninterruptible(
              Effect.gen(function* () {
                const executionTarget =
                  input.removeWorktree && target.kind === "local_worktree"
                    ? yield* removeWorkspaceSessionWorktree(dependencies, ref.repoPath, target)
                    : target;
                return yield* store
                  .archive({ ...ref, executionTarget, archivedAt: yield* Clock.currentTimeMillis })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new HostOperationError({
                          operation: "workspaceSession.archive.persist",
                          message:
                            "Could not save the archived chat. Retry archiving to finish the operation.",
                          cause,
                        }),
                    ),
                  );
              }),
            );
          }),
        ),
      ),
    restore: (input: WorkspaceSessionRefInput) =>
      operationGate.run(
        input,
        withWorktreeMutationAdmission(
          input.workspaceId,
          Effect.gen(function* () {
            const { ref, session } = yield* recordFor(input);
            if (session.archivedAt === null) return session;
            if (
              session.executionTarget.kind === "local_worktree" &&
              session.executionTarget.worktreeState === "removed"
            ) {
              const config = yield* settings.getRepoConfig(input.workspaceId);
              return yield* withRestoredWorkspaceSessionWorktree(
                dependencies,
                { ...config, repoPath: ref.repoPath },
                session.executionTarget,
                (executionTarget) => store.restore({ ...ref, executionTarget }),
              );
            }
            yield* validateWorkspaceSessionTarget(
              dependencies,
              ref.repoPath,
              session.executionTarget,
            );
            return yield* store.restore(ref);
          }),
        ),
      ),
  };
};

export type WorkspaceSessionService = ReturnType<typeof createWorkspaceSessionService>;
