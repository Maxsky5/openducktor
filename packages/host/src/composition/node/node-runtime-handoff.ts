import { createHash } from "node:crypto";
import { nativeHandoffAdmission } from "./native-handoff-admission";
import {
  resolveCodexEffectivePolicy,
  type AgentChatRef,
  type AgentMessageTarget,
  type AgentSessionLiveRef,
  type AgentSessionScope,
  type HandoffLink,
  type HandoffNativeSession,
} from "@openducktor/contracts";
import {
  agentSessionRefsEqual,
  compareRuntimeVersion,
  type WorkflowRolePolicyResolver,
} from "@openducktor/core";
import { Effect } from "effect";
import { createRuntimeHandoffCommands } from "../../application/agent-sessions/runtime-handoff-command";
import { validateTaskSessionWorkflowAvailable } from "../../application/tasks/support/task-session-workflow-validation";
import type { NodeTaskAssetServices } from "./node-task-asset-services";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { createAgentRuntimeQueryService } from "../../application/runtimes/agent-runtime-query-service";
import type { WorkspaceSessionUpdatedPublisher } from "../../application/workspaces/workspace-session-persistence-callbacks";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import { runtimeQueryError } from "../../ports/runtime-query-error";
import type { PrepareRolePolicy } from "../../application/agent-sessions/task-session-operations";

type CommandDependencies = Parameters<typeof createRuntimeHandoffCommands>[0];
export const digestHandoffPrefix = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export const stagedHandoffOwners = (
  sessions:
    | ReturnType<typeof import("./node-task-session-services").createNodeTaskSessionServices>
    | undefined,
  workspaceId: string,
): import("../../ports/workspace-session-store-port").RuntimeSessionOwner[] =>
  (sessions?.agentSessionCommandService.handoff?.stagedOwners() ?? [])
    .filter(({ chat }) => chat.workspaceId === workspaceId)
    .map(({ chat, target }) => ({
      runtimeKind: target.runtimeKind,
      externalSessionId: target.externalSessionId,
      ...(chat.kind === "workspace_session"
        ? { kind: "workspace" as const, sessionId: chat.sessionId, archived: false }
        : { kind: "task" as const, taskId: chat.taskId, role: chat.role }),
    }));

export const composeRuntimeHandoff = (deps: {
  assets: Pick<NodeTaskAssetServices, "workspaceSessionStore" | "runtimeHandoffs" | "taskStore">;
  taskWorkflows: TaskWorkflowResolver;
  resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  prepareRolePolicy: PrepareRolePolicy;
  settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig">;
  runtimeStatus: import("../../ports/runtime-registry-port").RuntimeRegistryPort["status"];
  runtime: CommandDependencies["runtime"] & {
    loadContext: import("../../application/agent-sessions/agent-session-live-state-service").AgentSessionLiveStateService["loadContext"];
    hasHandoffBlocker: (ref: AgentSessionLiveRef) => boolean;
  };
  queries: CommandDependencies["queries"] &
    Pick<
      ReturnType<typeof createAgentRuntimeQueryService>,
      "loadSessionHistory" | "loadStagedHandoffHistory"
    >;
  resolveParts: CommandDependencies["resolveParts"];
  worktreeReads: CommandDependencies["worktreeReads"];
  readPrefix: CommandDependencies["readPrefix"];
  taskPrompt: ReturnType<
    typeof import("../../application/agent-sessions/session-turn-preparation").createSessionTurnPreparation
  >["context"];
  publishWorkspace: WorkspaceSessionUpdatedPublisher;
  publishTask: (
    chat: Extract<AgentChatRef, { kind: "task_session" }>,
    records: import("@openducktor/contracts").AgentSessionRecord[],
  ) => Effect.Effect<void, import("../../effect/host-errors").HostError>;
}) => {
  const { workspaceSessionStore, taskStore, runtimeHandoffs } = deps.assets;
  const noOwner = () =>
    new HostValidationError({
      field: "chat",
      message: "The selected chat is unavailable. Reopen it before switching runtimes.",
    });

  const historyInput = (ref: AgentMessageTarget) =>
    Effect.gen(function* () {
      if (ref.runtimeKind === "opencode")
        return {
          ...ref,
          runtimeKind: ref.runtimeKind,
          runtimePolicy: { kind: "opencode" as const },
        };
      if (ref.runtimeKind === "claude")
        return { ...ref, runtimeKind: ref.runtimeKind, runtimePolicy: { kind: "claude" as const } };
      if (ref.runtimeKind === "antigravity")
        return {
          ...ref,
          runtimeKind: ref.runtimeKind,
          runtimePolicy: { kind: "antigravity" as const },
        };
      const scope = ref.sessionScope;
      const config = yield* deps.settingsConfig.readGlobalConfig();
      const policy = yield* Effect.try(() =>
        resolveCodexEffectivePolicy(
          config.agentRuntimes.codex,
          scope.kind === "workflow" ? scope.role : null,
          scope.kind === "workflow" &&
            !deps.resolveWorkflowRolePolicy({ ...scope, externalSessionId: ref.externalSessionId })
              .readOnly,
        ),
      );
      return {
        ...ref,
        runtimeKind: ref.runtimeKind,
        runtimePolicy: { kind: "codex" as const, policy },
      };
    }).pipe(
      Effect.mapError((cause) =>
        runtimeQueryError(
          "loadSessionHistory",
          ref,
          "scope_mismatch",
          "Cannot resolve the native session policy.",
          cause,
        ),
      ),
    );

  return (
    creation: CommandDependencies["creation"],
    policyFor: (scope: AgentSessionScope) => ReturnType<CommandDependencies["policyFor"]>,
    withRootLock: CommandDependencies["withRootLock"],
  ) =>
    createRuntimeHandoffCommands({
      ...deps,
      creation: {
        startSession: (input) => {
          const scope = input.sessionScope;
          if (scope.kind !== "workflow") return creation.startSession(input);
          return Effect.scoped(
            Effect.gen(function* () {
              const policy = yield* deps.prepareRolePolicy({
                ...scope,
                repoPath: input.repoPath,
                externalSessionId: null,
              });
              const session = yield* creation.startSession(input);
              yield* policy.keep(session.externalSessionId);
              return session;
            }),
          );
        },
      },
      policyFor,
      withRootLock,
      requireDestinationAdmission: (kind) =>
        kind === "codex"
          ? deps.runtimeStatus(kind).pipe(
              Effect.flatMap((status) => {
                const version = status.version ?? null;
                // Codex 0.136.0 supports clientUserMessageId on send and returns clientId in history.
                const supported = compareRuntimeVersion(version, "0.136.0");
                return supported?.supported &&
                  (supported.version !== "0.136.0" || !version?.includes("0.136.0-"))
                  ? Effect.void
                  : Effect.fail(
                      new HostValidationError({
                        field: "handoff",
                        message: "Update Codex to 0.136.0 or later to use runtime handoff.",
                      }),
                    );
              }),
            )
          : Effect.void,
      digestPrefix: digestHandoffPrefix,
      admission: nativeHandoffAdmission,
      resolveOwner: (chat) =>
        Effect.gen(function* () {
          if (chat.kind === "workspace_session") {
            const record = yield* workspaceSessionStore.get(chat);
            if (!record.externalSessionId) return yield* noOwner();
            const requireWritable = Effect.gen(function* () {
              if (record.archivedAt !== null) return yield* noOwner();
              if (
                record.executionTarget.kind === "local_worktree" &&
                record.executionTarget.worktreeState === "removed"
              )
                return yield* new HostValidationError({
                  field: "workingDirectory",
                  message: "Restore the chat worktree before switching runtimes.",
                });
            });
            const title = record.manualTitle ?? record.generatedTitle;
            const scope: Extract<AgentSessionScope, { kind: "repository" }> = {
              kind: "repository",
              workspaceId: chat.workspaceId,
            };
            if (title) scope.title = title;
            return {
              scope,
              requireWritable,
              prepareSend: Effect.succeed(record.roleSnapshot?.systemPrompt ?? ""),
              active: {
                runtimeKind: record.runtimeKind,
                workingDirectory: record.executionTarget.workingDirectory,
                externalSessionId: record.externalSessionId,
              },
              links: record.handoff?.links ?? [],
            };
          }
          const { agentSessions } = yield* taskStore.getTaskMetadata(chat);
          const equal = (ref: HandoffNativeSession) =>
            agentSessionRefsEqual(
              { ...ref, repoPath: chat.repoPath },
              { ...chat.first, repoPath: chat.repoPath },
            );
          const record = agentSessions.find(
            (session) => session.role === chat.role && equal(session),
          );
          if (
            !record ||
            agentSessions.some((session) => session.handoff?.links.some(({ to }) => equal(to)))
          )
            return yield* noOwner();
          const links = record.handoff?.links ?? [];
          const active = links.at(-1)?.to ?? chat.first;
          const scope = {
            kind: "workflow" as const,
            workspaceId: chat.workspaceId,
            taskId: chat.taskId,
            role: chat.role,
          };
          const prepareSend = Effect.gen(function* () {
            const task = yield* taskStore.getTask(chat);
            if (task.status === "closed") return yield* noOwner();
            yield* validateTaskSessionWorkflowAvailable(
              deps.taskWorkflows.forTask(task),
              task,
              chat.role,
              chat.repoPath,
            );
            const prompt = yield* deps.taskPrompt({
              ...active,
              repoPath: chat.repoPath,
              sessionScope: scope,
            });
            return prompt ?? "";
          }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "handoff.prepare-send")));
          return {
            scope,
            prepareSend,
            requireWritable: Effect.void,
            active,
            links,
          };
        }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "handoff.owner"))),
      readHistory: (ref) => historyInput(ref).pipe(Effect.flatMap(deps.queries.loadSessionHistory)),
      readStagedHistory: (ref) =>
        historyInput(ref).pipe(Effect.flatMap(deps.queries.loadStagedHandoffHistory)),
      readDestinationBudget: (target, model, contextWindow) =>
        target.runtimeKind === "opencode"
          ? Effect.succeed({ contextWindow, usedTokens: 0 })
          : deps.runtime.loadContext({ ...target, handoffModelId: model.modelId }).pipe(
              Effect.map((usage) => ({
                contextWindow: usage?.contextWindow,
                usedTokens: usage?.totalTokens ?? 0,
              })),
            ),
      ensureNoScheduledWork: (ref) =>
        deps.runtime.hasHandoffBlocker(ref)
          ? Effect.fail(
              new HostValidationError({
                field: "handoff",
                message:
                  "Clear queued messages or cancel the scheduled resume before switching runtimes.",
              }),
            )
          : Effect.void,
      checkActiveMember: (target) =>
        Effect.gen(function* () {
          const scope = target.sessionScope;
          const identity = { workspaceId: scope.workspaceId, repoPath: target.repoPath };
          const isHistorical = (link: HandoffLink) =>
            agentSessionRefsEqual(target, { ...link.from, repoPath: target.repoPath });
          const sessions =
            scope.kind === "workflow"
              ? (yield* taskStore.getTaskMetadata({ ...identity, taskId: scope.taskId }))
                  .agentSessions
              : yield* Effect.forEach(
                  (yield* workspaceSessionStore.listRuntimeOwners({
                    ...identity,
                    filter: {
                      runtimeKind: target.runtimeKind,
                      externalSessionIds: [target.externalSessionId],
                    },
                  })).flatMap((owner) => (owner.kind === "workspace" ? [owner.sessionId] : [])),
                  (sessionId) => workspaceSessionStore.get({ ...identity, sessionId }),
                );
          if (sessions.some((session) => session.handoff?.links.some(isHistorical)))
            return yield* new HostValidationError({
              field: "externalSessionId",
              message:
                "This session is a previous runtime of the chat. Reopen the chat to continue with its active runtime.",
            });
        }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "handoff.active-member"))),
      commit: (input) =>
        runtimeHandoffs
          .commit(input)
          .pipe(Effect.mapError((cause) => toHostOperationError(cause, "handoff.commit"))),
      publishOwner: (chat) =>
        (chat.kind === "workspace_session"
          ? workspaceSessionStore
              .get(chat)
              .pipe(Effect.flatMap((record) => deps.publishWorkspace(chat.workspaceId, record)))
          : taskStore
              .getTaskMetadata(chat)
              .pipe(Effect.flatMap(({ agentSessions }) => deps.publishTask(chat, agentSessions)))
        ).pipe(Effect.mapError((cause) => toHostOperationError(cause, "handoff.publish"))),
    });
};
