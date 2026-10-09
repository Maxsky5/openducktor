import { TaskSessionOwnershipCommittedError } from "./task-session-ownership-error";
import { createWorkflowLaunchSubmission } from "./workflow-launch-submission";
import type {
  WorkflowLaunchContext,
  WorkflowLaunchDependencies,
  WorkflowLaunchService,
} from "./workflow-launch-types";
import type {
  AgentWorkflowSessionStartInput,
  AgentSessionControlResumeInput,
  WorkflowLaunchRead,
  WorkflowLaunchRef,
  WorkflowLaunchRequest,
  WorkflowLaunchSnapshot,
} from "@openducktor/contracts";
import type { SessionLaunchInitial, SessionLaunchSendInput } from "./session-launch-types";
import { Effect } from "effect";
import { createSessionLaunchService } from "./session-launch-service";
import { findWorkflowSession, toControlSessionRef } from "./task-workflow-session-storage";
import {
  launchValidationError,
  prepareWorkflowLaunch,
  resolveLaunchWorkspace,
  workflowActionId,
} from "./workflow-launch-preparation";
import { toHostOperationError } from "../../effect/host-errors";
import { getSessionLaunchAction } from "@openducktor/core";

export type { WorkflowLaunchService } from "./workflow-launch-types";

export const createWorkflowLaunchService = (
  deps: WorkflowLaunchDependencies,
): WorkflowLaunchService => {
  const withReservation = <A, E>(attempt: WorkflowLaunchContext, work: Effect.Effect<A, E>) =>
    deps.withProcessStartAdmission(
      attempt.snapshot.repoPath,
      deps.lifecycle.runReservedTaskOperation(
        attempt.snapshot.repoPath,
        attempt.request.taskId,
        work,
      ),
    );
  const { send, validateRecovery } = createWorkflowLaunchSubmission(deps);
  const publishRecords = (attempt: WorkflowLaunchContext) =>
    Effect.gen(function* () {
      const session = attempt.snapshot.session;
      if (!session)
        return yield* launchValidationError("The runtime returned no workflow session identity.");
      const repoPath = attempt.snapshot.repoPath;
      const taskId = attempt.request.taskId;
      const agentSessions = yield* deps.tasks.agentSessionsList({ repoPath, taskId });
      // Readers must bind the saved owner before the runtime publishes its first message.
      yield* deps.runtime.publishTaskSessionRecords(toControlSessionRef(repoPath, session), {
        taskId,
        agentSessions,
      });
    });
  const resumeSession = (
    attempt: WorkflowLaunchContext,
    input: Parameters<typeof deps.runtime.resumeSession>[0],
  ) =>
    deps.runtime
      .resumeSession(input)
      .pipe(
        Effect.tapError((cause) =>
          cause instanceof TaskSessionOwnershipCommittedError
            ? Effect.sync(() => attempt.stage("publication"))
            : Effect.void,
        ),
      );
  const run = (attempt: WorkflowLaunchContext) =>
    Effect.gen(function* () {
      yield* attempt.checkCanceled();
      attempt.stage("workspace");
      const { config, repoPath } = yield* resolveLaunchWorkspace(deps, attempt.request);
      attempt.updateOwner({ repoPath });
      return yield* withReservation(
        attempt,
        attempt.withSession(
          Effect.gen(function* () {
            attempt.stage("prepare");
            yield* attempt.prepare();
            const prepared = yield* prepareWorkflowLaunch(
              deps,
              attempt.request,
              repoPath,
              config,
              (action) =>
                attempt.updateOwner({
                  completedPreStartActions: [...attempt.snapshot.completedPreStartActions, action],
                }),
              (source) => {
                attempt.targetSession(source);
              },
            );
            if (prepared.kind === "skipped") {
              attempt.skip(prepared.reason);
              return;
            }
            yield* attempt.checkCanceled();
            const { decision, action, speed, systemPrompt, parts } = prepared;
            let { model } = prepared;
            if (model) attempt.updateOwner({ model });
            const sessionScope = {
              kind: "workflow" as const,
              taskId: attempt.request.taskId,
              role: action.role,
            };
            const publications: Array<Effect.Effect<void, unknown>> = [];
            const retainInstruction = (result: Parameters<typeof toControlSessionRef>[1]) => {
              if (parts === undefined) return;
              const input: SessionLaunchSendInput = {
                ...toControlSessionRef(repoPath, result),
                sessionScope,
                systemPrompt,
                speed,
                parts,
              };
              if (model) input.model = model;
              attempt.retainInstruction(input);
            };
            const retainSession = (result: Parameters<typeof toControlSessionRef>[1]) =>
              Effect.sync(() => {
                attempt.retainSession(result);
                return result;
              });
            const progress = {
              checkCanceled: attempt.checkCanceled,
              created: (summary: Parameters<typeof toControlSessionRef>[1]) =>
                retainSession(summary).pipe(
                  Effect.andThen(
                    parts !== undefined && decision.startMode !== "reuse"
                      ? deps.runtime.holdWorkflowLaunch(
                          toControlSessionRef(repoPath, summary),
                          true,
                        )
                      : Effect.void,
                  ),
                  Effect.asVoid,
                ),
              saved: attempt.ownershipSaved,
              stop: attempt.stopSession,
            };
            attempt.stage("session");
            if (decision.startMode === "fresh") {
              const startInput: AgentWorkflowSessionStartInput = {
                repoPath,
                runtimeKind: decision.selectedModel.runtimeKind,
                sessionScope,
                systemPrompt,
                model: decision.selectedModel,
                speed: speed ?? "standard",
              };
              if (attempt.request.targetWorkingDirectory)
                startInput.targetWorkingDirectory = attempt.request.targetWorkingDirectory;
              const result = yield* deps.sessions.start(startInput, progress);
              retainInstruction(result.session);
              publications.push(result.publish.pipe(Effect.andThen(publishRecords(attempt))));
            } else if (decision.startMode === "fork") {
              const result = yield* deps.sessions.fork(
                {
                  repoPath,
                  ...decision.sourceSession,
                  parentExternalSessionId: decision.sourceSession.externalSessionId,
                  sessionScope,
                  model: decision.selectedModel,
                  speed: speed ?? "standard",
                  systemPrompt,
                },
                progress,
              );
              retainInstruction(result.session);
              publications.push(result.publish.pipe(Effect.andThen(publishRecords(attempt))));
            } else {
              // Keep the source session available when resume fails.
              const records = yield* deps.tasks.agentSessionsList({
                repoPath,
                taskId: attempt.request.taskId,
              });
              const source = findWorkflowSession(records, action.role, decision.sourceSession)!;
              model = source.selectedModel ?? undefined;
              attempt.updateOwner({ model });
              const retained = yield* retainSession({
                ...decision.sourceSession,
                startedAt: source.startedAt,
                status: "idle",
              });
              retainInstruction(retained);
              attempt.ownershipSaved();
              const live = yield* deps.runtime.read({ repoPath, ...decision.sourceSession });
              if (live.type === "missing") {
                const resumeInput: AgentSessionControlResumeInput = {
                  repoPath,
                  ...decision.sourceSession,
                  sessionScope,
                  resumeMode: "reattach",
                  systemPrompt,
                };
                if (model) resumeInput.model = model;
                const resumed = yield* resumeSession(attempt, resumeInput);
                attempt.retainSession(resumed);
                publications.push(publishRecords(attempt));
              }
            }
            if (!attempt.snapshot.session)
              return yield* launchValidationError(
                "The runtime returned no workflow session identity.",
              );
            attempt.stage("publication");
            for (const publication of publications) yield* publication;
            yield* attempt.checkCanceled();
            if (parts !== undefined) yield* send(attempt);
          }),
        ),
      );
    });
  return createSessionLaunchService<
    WorkflowLaunchRequest,
    WorkflowLaunchSnapshot,
    WorkflowLaunchRef,
    WorkflowLaunchRead
  >({
    runtime: deps.runtime,
    publish: deps.publish,
    initial: (request) => {
      const initial: SessionLaunchInitial<WorkflowLaunchSnapshot> = {
        snapshot: {
          launchAttemptId: request.launchAttemptId,
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
          role: getSessionLaunchAction(workflowActionId(request)).role,
          phase: "queued",
          acceptance: "not_submitted",
          ownershipSaved: false,
          completedPreStartActions: [],
        },
      };
      if (request.policy.kind === "manual" && request.policy.decision.startMode === "reuse")
        initial.target = { repoPath: request.repoPath, ...request.policy.decision.sourceSession };
      return initial;
    },
    key: (request) => `${request.workspaceId}\0${request.taskId}`,
    queue: (request) => request.queueIfBusy === true || request.policy.kind === "automatic",
    matches: (request, ref) =>
      request.workspaceId === ref.workspaceId &&
      request.repoPath === ref.repoPath &&
      request.taskId === ref.taskId,
    includes: (request, ref) =>
      request.workspaceId === ref.workspaceId &&
      request.repoPath === ref.repoPath &&
      request.taskId === ref.taskId &&
      (!ref.launchAttemptId || request.launchAttemptId === ref.launchAttemptId),
    validateRead: (input) =>
      resolveLaunchWorkspace(deps, input).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => toHostOperationError(cause, "workflow-launch.read")),
      ),
    run,
    recover: (attempt) =>
      Effect.gen(function* () {
        yield* resolveLaunchWorkspace(deps, attempt.request);
        yield* withReservation(
          attempt,
          attempt.withSession(
            Effect.gen(function* () {
              yield* validateRecovery(attempt);
              const sendInput = attempt.sendInput!;
              const live = yield* deps.runtime.read(
                toControlSessionRef(attempt.snapshot.repoPath, attempt.snapshot.session!),
              );
              if (live.type === "missing") {
                const resumed = yield* resumeSession(attempt, {
                  ...sendInput,
                  resumeMode: "reattach",
                });
                attempt.retainSession(resumed);
                attempt.stage("publication");
                yield* publishRecords(attempt);
              }
              yield* send(attempt);
            }),
          ),
        );
      }),
  });
};
