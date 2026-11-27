import type {
  AgentSessionControlSendInput,
  StartupStep,
  WorkspaceSession,
  WorkspaceSessionExecutionTarget,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import { chatNamingWorkText } from "@openducktor/workflows";
import { Clock, Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { checkoutBranch } from "../../domain/task/task-branch-policy";
import { visibleMessageText } from "../../domain/workspace-sessions/workspace-session-title";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { createSessionLaunchService } from "../agent-sessions/session-launch-service";
import {
  finalizeStartup,
  startupStep,
  updateStartup,
} from "../agent-sessions/session-startup-progress";
import type { resolveSessionMessageParts } from "../attachments/resolve-session-message-parts";
import { branchNamingStep, nameBranch } from "../naming/branch-naming";
import type { NamingService } from "../naming/naming-service";
import {
  fallbackWorkspaceSessionBranch,
  type WorkspaceSessionNaming,
} from "./workspace-session-naming";
import type { WorkspaceSessionUpdatedPublisher } from "./workspace-session-persistence-callbacks";
import { createWorkspaceSessionRecordReader } from "./workspace-session-record-reader";
import {
  createWorkspaceSessionBind,
  type WorkspaceSessionStartDependencies,
} from "./workspace-session-start";
import {
  withWorkspaceSessionTarget,
  type WorkspaceSessionDestination,
  type WorkspaceSessionTargetBranchNaming,
  type WorkspaceSessionTargetCreationDependencies,
} from "./workspace-session-target";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceSessionLaunchDependencies = WorkspaceSessionStartDependencies &
  WorkspaceSessionTargetCreationDependencies & {
    git: WorkspaceSessionStartDependencies["git"] &
      WorkspaceSessionTargetCreationDependencies["git"] &
      Pick<GitPort, "listRefNames" | "listRemoteNames">;
    store: WorkspaceSessionStartDependencies["store"] & Pick<WorkspaceSessionStorePort, "create">;
    settings: WorkspaceSessionStartDependencies["settings"] &
      Pick<WorkspaceSettingsService, "getRepoConfig" | "listCustomAgentRoles">;
    chatNaming: Pick<WorkspaceSessionNaming, "registerCreated">;
    naming: NamingService;
    resolveParts: (
      parts: Parameters<typeof resolveSessionMessageParts>[0],
    ) => ReturnType<typeof resolveSessionMessageParts>;
    commands: Pick<SessionLaunchRuntimePort, "sendUserMessage">;
    live: WorkspaceSessionStartDependencies["live"] &
      Pick<SessionLaunchRuntimePort, "holdWorkflowLaunch" | "stopSession" | "reportLaunchFailure">;
    publishUpdated: WorkspaceSessionUpdatedPublisher;
  };

const MAX_SAVED_DRAFT_SESSION_ENTRIES = 500;
const SESSION_TAIL_STEPS = [
  { id: "prepare", label: "Start session", state: "pending" as const },
  { id: "instruction", label: "Submit initial instruction", state: "pending" as const },
] as const;

/** Creates a deferred workspace session, starts its runtime, and delivers its first message. */
export const createWorkspaceSessionLaunchService = (deps: WorkspaceSessionLaunchDependencies) => {
  const { recordFor } = createWorkspaceSessionRecordReader(deps);
  const bindSession = createWorkspaceSessionBind(deps);
  const savedSessionIdByDraftKey = new Map<string, string>();
  const rememberSavedDraftSession = (draftKey: string, sessionId: string) => {
    savedSessionIdByDraftKey.delete(draftKey);
    if (savedSessionIdByDraftKey.size >= MAX_SAVED_DRAFT_SESSION_ENTRIES) {
      const oldestKey = savedSessionIdByDraftKey.keys().next().value;
      if (oldestKey !== undefined) savedSessionIdByDraftKey.delete(oldestKey);
    }
    savedSessionIdByDraftKey.set(draftKey, sessionId);
  };
  return createSessionLaunchService<WorkspaceSessionLaunchRequest, WorkspaceSessionLaunchResult>({
    runtime: deps.live,
    send: (_request, input, options) => deps.commands.sendUserMessage(input, options),
    initial: (request) =>
      Effect.succeed({
        workspaceId: request.workspaceId,
        repoPath: request.repoPath,
        status: "completed" as const,
      }),
    key: (request) => JSON.stringify([request.workspaceId, "draft", request.draftId]),
    run: (attempt) =>
      Effect.gen(function* () {
        const request = attempt.request;
        yield* attempt.checkCanceled();
        const draftKey = JSON.stringify([request.workspaceId, request.draftId]);
        const existingSessionId = savedSessionIdByDraftKey.get(draftKey);
        if (existingSessionId !== undefined) {
          const existing = yield* recordFor({
            workspaceId: request.workspaceId,
            sessionId: existingSessionId,
          }).pipe(Effect.catchTag("HostResourceError", () => Effect.succeed(null)));
          if (existing !== null) {
            attempt.ownershipSaved();
            attempt.setResultFields({
              sessionId: existing.session.id,
              record: existing.session,
            });
            yield* updateStartup((progress) =>
              progress.ownership({
                state: "saved",
                target: { kind: "workspace", record: existing.session },
              }),
            );
            return yield* invalid(
              "This draft already created a workspace session. Inspect the saved session before starting or sending again.",
            );
          }
          return yield* invalid(
            "This draft was already used to create a workspace session. Start a new draft instead.",
          );
        }
        const config = yield* deps.settings.getRepoConfig(request.workspaceId);
        const repoPath = yield* deps.git.canonicalizePath(config.repoPath);
        const assertedRepoPath = yield* deps.git.canonicalizePath(request.repoPath);
        if (normalizePathForComparison(repoPath) !== normalizePathForComparison(assertedRepoPath)) {
          return yield* invalid("Workspace and repository do not match.");
        }
        const roles =
          request.customAgentRoleId === null ? [] : yield* deps.settings.listCustomAgentRoles();
        const role = roles.find((candidate) => candidate.id === request.customAgentRoleId);
        if (request.customAgentRoleId !== null && !role) {
          return yield* new HostResourceError({
            resource: request.customAgentRoleId,
            operation: "workspaceSession.launch",
            message:
              "The selected Custom Agent Role no longer exists. Select another Role or No Role.",
          });
        }
        const roleSnapshot = role ? { ...role } : null;
        yield* startupStep(
          { id: "checks", label: "Check runtime availability" },
          deps.runtime.requireReady(request.runtimeKind),
        );
        yield* attempt.checkCanceled();
        const parts = yield* deps.resolveParts(request.parts);
        yield* attempt.checkCanceled();

        const sessionId = crypto.randomUUID();
        const destination: WorkspaceSessionDestination =
          request.location === "local_repo_root"
            ? { location: "local_repo_root" }
            : request.location === "existing_worktree"
              ? { location: "existing_worktree", existingWorktree: request.existingWorktree }
              : { location: "local_worktree", worktree: request.worktree };

        const needsAutoBranch =
          request.location === "local_worktree" &&
          request.worktree.mode === "from_name" &&
          request.worktree.branchName === null;
        const messageText = visibleMessageText(parts);
        const namingConfig = messageText ? config : { ...config, namingModel: undefined };
        const branchNaming: WorkspaceSessionTargetBranchNaming | undefined = needsAutoBranch
          ? {
              step: branchNamingStep(namingConfig, true) ?? {
                id: "naming",
                label: "Choose branch name",
              },
              resolve: (canonicalRepoPath) => {
                const step = branchNamingStep(namingConfig, true) ?? {
                  id: "naming",
                  label: "Choose branch name",
                };
                return startupStep(
                  step,
                  nameBranch(
                    { naming: deps.naming, git: deps.git },
                    {
                      repoConfig: namingConfig,
                      gitDirectory: canonicalRepoPath,
                      workText: chatNamingWorkText(messageText),
                      reserved: [checkoutBranch(request.targetBranch)],
                      fallback: fallbackWorkspaceSessionBranch(config.branchPrefix, messageText),
                      withTitle: true,
                    },
                  ),
                  (result): Partial<Omit<StartupStep, "id" | "label" | "state">> => {
                    const details = result.notice
                      ? [result.branch, result.notice]
                      : [result.branch];
                    return result.notice ? { details, warning: result.notice } : { details };
                  },
                );
              },
            }
          : undefined;

        const saveRecord = (
          executionTarget: WorkspaceSessionExecutionTarget,
          generatedTitle: string | null,
        ) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const session: WorkspaceSession = {
              id: sessionId,
              runtimeKind: request.runtimeKind,
              externalSessionId: null,
              executionTarget,
              roleSnapshot,
              selectedModel: request.selectedModel,
              generatedTitle,
              manualTitle: null,
              targetBranch: request.targetBranch,
              createdAt: now,
              updatedAt: now,
              archivedAt: null,
            };
            return yield* startupStep(
              { id: "save", label: "Save workspace session" },
              deps.store
                .create({
                  workspaceId: request.workspaceId,
                  repoPath,
                  session,
                })
                .pipe(
                  Effect.tapError(() =>
                    updateStartup((progress) => progress.ownership({ state: "unknown" })),
                  ),
                ),
            );
          });

        const targetInput: Parameters<typeof withWorkspaceSessionTarget>[1] = {
          owner: { workspaceId: request.workspaceId, sessionId },
          destination,
          repoConfig: { ...config, repoPath },
          targetBranch: request.targetBranch,
          tailSteps: SESSION_TAIL_STEPS,
        };
        if (branchNaming) {
          targetInput.branchNaming = branchNaming;
        }
        const saved = yield* withWorkspaceSessionTarget(
          deps,
          targetInput,
          (executionTarget, retainTarget, generatedTitle) =>
            Effect.gen(function* () {
              yield* attempt.checkCanceled();
              const created = yield* saveRecord(executionTarget, generatedTitle);
              rememberSavedDraftSession(draftKey, created.id);
              retainTarget();
              attempt.ownershipSaved();
              attempt.keepInstruction(request.parts);
              attempt.setResultFields({ sessionId: created.id, record: created });
              if (created.selectedModel) attempt.setResultFields({ model: created.selectedModel });
              if (!needsAutoBranch) {
                deps.chatNaming.registerCreated({
                  workspaceId: request.workspaceId,
                  sessionId: created.id,
                });
              }
              yield* updateStartup((progress) =>
                progress.ownership({
                  state: "saved",
                  target: { kind: "workspace", record: created },
                }),
              );
              yield* deps.publishUpdated(request.workspaceId, created);
              return created;
            }),
        );

        yield* attempt.checkCanceled();
        const started = yield* bindSession(
          { workspaceId: request.workspaceId, sessionId: saved.id },
          {
            beforeBind: attempt.checkCanceled,
            onBound: (boundRecord, summary) => {
              attempt.setResultFields({ record: boundRecord });
              if (boundRecord.selectedModel) {
                attempt.setResultFields({ model: boundRecord.selectedModel });
              }
              return attempt.createdSession(repoPath, summary, { hold: true });
            },
            workStartGuard: { assertCurrent: attempt.assertCurrent },
          },
        );
        const boundRecord = started.session;
        if (!boundRecord.externalSessionId) {
          return yield* invalid("The host did not save a runtime session identity.");
        }
        const ref = {
          repoPath,
          runtimeKind: boundRecord.runtimeKind,
          workingDirectory: boundRecord.executionTarget.workingDirectory,
          externalSessionId: boundRecord.externalSessionId,
        };
        const sessionScope = { kind: "repository" as const, workspaceId: request.workspaceId };
        yield* deps.publishUpdated(request.workspaceId, boundRecord);
        yield* finalizeStartup(ref);

        const input: AgentSessionControlSendInput = {
          ...ref,
          sessionScope,
          parts,
          delivery: "new_turn",
        };
        yield* attempt.send(input, request.parts);
        attempt.setResultFields({
          record: (yield* recordFor({ workspaceId: request.workspaceId, sessionId: saved.id }))
            .session,
        });
      }),
  });
};

export type WorkspaceSessionLaunchService = ReturnType<typeof createWorkspaceSessionLaunchService>;
const invalid = (message: string) =>
  new HostValidationError({ field: "workspaceSessionLaunch", message });
