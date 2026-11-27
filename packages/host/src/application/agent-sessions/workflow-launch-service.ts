import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
  StartupStep,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import type { AgentWorkStartOptions } from "@openducktor/core";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { finalizeStartup, startupStep, updateStartup } from "./session-startup-progress";
import { existingCheckoutStepMeta } from "./worktree-setup-plan";
import type { TaskServiceError } from "../tasks/task-service";
import { createSessionLaunchService } from "./session-launch-service";
import type { SessionLaunchContext } from "./session-launch-types";
import type { TaskSessionProgress } from "./task-session-operations";
import { toControlSessionRef } from "./task-workflow-session-storage";
import {
  prepareWorkflowLaunch,
  resolveLaunchWorkspace,
  requireInitialLaunchRole,
  isStartupRepair,
} from "./workflow-launch-preparation";
import type {
  WorkflowLaunchAttemptRequest,
  WorkflowLaunchDependencies,
  WorkflowLaunchService,
} from "./workflow-launch-types";

export type { WorkflowLaunchService } from "./workflow-launch-types";

/** Runs workflow launches one at a time for each task. */
export const createWorkflowLaunchService = (
  deps: WorkflowLaunchDependencies,
): WorkflowLaunchService => {
  const run = (attempt: SessionLaunchContext<WorkflowLaunchAttemptRequest, WorkflowLaunchResult>) =>
    Effect.gen(function* () {
      const request = attempt.request;
      yield* attempt.checkCanceled();
      if (request.policy.kind === "automatic") {
        const check = yield* request.policy.startCheck;
        if (!check.start) {
          attempt.skip(check.reason);
          return;
        }
      }
      const { config, repoPath } = yield* startupStep(
        { id: "request", label: "Check startup request" },
        resolveLaunchWorkspace(deps, request),
      );
      const prepared = yield* startupStep(
        { id: "checks", label: "Check task and runtime choices" },
        prepareWorkflowLaunch(deps, request, repoPath, config, attempt.targetSession),
      );
      if (prepared.kind === "skipped") {
        attempt.skip(prepared.reason);
        return;
      }
      yield* attempt.checkCanceled();
      const { decision, action, model, systemPrompt, parts, queuedFeedbackEvent } = prepared;
      // Rejected feedback must retry the launch with its event, not send a bare message.
      const retryInstruction =
        queuedFeedbackEvent === undefined
          ? request.instruction.kind === "message"
            ? request.instruction.parts
            : parts
          : undefined;
      if (retryInstruction !== undefined) attempt.keepInstruction(retryInstruction);
      attempt.setResultFields({ role: action.role, startMode: decision.startMode });
      if (model) attempt.setResultFields({ model });
      const sessionScope = {
        kind: "workflow" as const,
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        role: action.role,
      };
      const progress: TaskSessionProgress = {
        checkCanceled: attempt.checkCanceled,
        workStartGuard: { assertCurrent: attempt.assertCurrent },
        created: (summary) =>
          attempt.createdSession(repoPath, summary, { hold: parts !== undefined }),
        saved: attempt.ownershipSaved,
        stop: attempt.stopSession,
      };
      let session: AgentSessionControlSummary;
      let publish: Effect.Effect<void, TaskServiceError> | null = null;
      const instructionPlan =
        parts !== undefined
          ? [{ id: "instruction", label: "Submit initial instruction", state: "pending" as const }]
          : [];
      if (decision.startMode === "fresh") {
        yield* updateStartup((startup) =>
          startup.plan([
            { id: "prepare", label: "Start session", state: "pending" },
            ...instructionPlan,
          ]),
        );
        const startInput: AgentWorkflowSessionStartInput = {
          repoPath,
          runtimeKind: decision.selectedModel.runtimeKind,
          sessionScope,
          systemPrompt,
          model: decision.selectedModel,
        };
        if (decision.targetWorkingDirectory)
          startInput.targetWorkingDirectory = decision.targetWorkingDirectory;
        ({ session, publish } = yield* deps.sessions.start(startInput, progress));
      } else if (decision.startMode === "fork") {
        yield* updateStartup((startup) =>
          startup.plan([
            {
              id: "checkout",
              label: "Reuse task worktree",
              state: "completed",
              details: [decision.sourceSession.workingDirectory],
              resources: [
                {
                  kind: "worktree",
                  value: decision.sourceSession.workingDirectory,
                  state: "reused",
                },
              ],
            },
            { id: "prepare", label: "Fork session", state: "pending" },
            ...instructionPlan,
          ]),
        );
        ({ session, publish } = yield* deps.sessions.fork(
          {
            repoPath,
            ...decision.sourceSession,
            parentExternalSessionId: decision.sourceSession.externalSessionId,
            sessionScope,
            model: decision.selectedModel,
            systemPrompt,
          },
          progress,
        ));
      } else {
        const { source, live } = decision;
        const isMainCheckout =
          normalizePathForComparison(source.workingDirectory) ===
          normalizePathForComparison(repoPath);
        const checkoutStep: StartupStep = {
          ...existingCheckoutStepMeta(
            source.workingDirectory,
            isMainCheckout,
            "Reuse task worktree",
          ),
          state: "completed",
        };
        yield* updateStartup((startup) =>
          startup.plan([
            checkoutStep,
            ...(live.type !== "live"
              ? [{ id: "prepare", label: "Resume session", state: "pending" as const }]
              : []),
            ...instructionPlan,
          ]),
        );
        session = { ...decision.sourceSession, startedAt: source.startedAt, status: "idle" };
        attempt.reusedSession(repoPath, session);
        yield* updateStartup((progress) =>
          progress.ownership({
            state: "saved",
            target: { kind: "task", record: source, runtimeSession: session },
          }),
        );
        if (live.type !== "live") {
          const resumeInput: AgentSessionControlResumeInput & AgentWorkStartOptions = {
            repoPath,
            ...decision.sourceSession,
            sessionScope,
            resumeMode: "reattach",
            systemPrompt,
            workStartGuard: { assertCurrent: attempt.assertCurrent },
          };
          if (model) resumeInput.model = model;
          ({ session, publish } = yield* startupStep(
            { id: "prepare", label: "Resume session" },
            deps.sessions.resume(resumeInput),
          ));
          attempt.reusedSession(repoPath, session);
        }
        if (model && model.speed !== source.selectedModel?.speed)
          yield* deps.runtime.updateSessionModel({
            repoPath,
            ...decision.sourceSession,
            sessionScope,
            model,
            workStartGuard: { assertCurrent: attempt.assertCurrent },
          });
      }
      if (publish) {
        yield* startupStep({ id: "publish", label: "Publish saved session" }, publish);
        const agentSessions = yield* deps.tasks.agentSessionsList({
          workspaceId: request.workspaceId,
          repoPath,
          taskId: request.taskId,
        });
        // Readers bind the saved owner with its live activity before the first instruction.
        yield* deps.runtime.publishTaskSessionRecords(toControlSessionRef(repoPath, session), {
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          agentSessions,
        });
      }
      if (isStartupRepair(request, decision.startMode))
        yield* deps.sessions.completeSavedStart({ repoPath, sessionScope, session });
      yield* finalizeStartup(toControlSessionRef(repoPath, session));
      if (parts === undefined) return;
      const input: AgentSessionControlSendInput = {
        ...toControlSessionRef(repoPath, session),
        sessionScope,
        systemPrompt,
        parts,
        delivery: "new_turn",
      };
      yield* attempt.send(retryInstruction, (options) => {
        if (request.goal) {
          // The launch holds its new session as running, so it sets the goal without the `/goal`
          // busy check of a composer message.
          return deps.runtime.controlGoal(
            {
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
              sessionScope: input.sessionScope,
              systemPrompt: input.systemPrompt,
              command: { kind: "set", objective: request.goal.objective },
            },
            options,
          );
        }
        if (request.policy.kind === "manual" && decision.startMode !== "reuse")
          return deps.runtime.sendUserMessage(input, options);
        const submissionId = crypto.randomUUID();
        return deps.messageDelivery
          .submit(
            {
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
              sessionScope: input.sessionScope,
              parts: input.parts,
              submissionId,
              mode: "default",
            },
            options,
            queuedFeedbackEvent === undefined
              ? undefined
              : (onCommitted) =>
                  deps.tasks
                    .applyTaskEvent(
                      {
                        workspaceId: request.workspaceId,
                        repoPath,
                        taskId: request.taskId,
                        eventId: queuedFeedbackEvent,
                      },
                      onCommitted,
                    )
                    .pipe(
                      Effect.mapError((cause) =>
                        toHostOperationError(cause, "workflow-launch.commit-feedback"),
                      ),
                    ),
          )
          .pipe(
            Effect.flatMap((result) => {
              if (result.kind === "accepted") return Effect.succeed(result.acceptedMessage);
              if (
                result.kind === "queued" &&
                request.policy.kind === "manual" &&
                result.queue.entries.some(
                  (entry) =>
                    entry.submissionId === submissionId && entry.state === "acceptance_unknown",
                )
              )
                return Effect.fail(
                  new HostOperationError({
                    operation: "workflow-launch.instruction",
                    message: "The runtime did not confirm the instruction.",
                  }),
                );
              return Effect.succeed(undefined);
            }),
          );
      });
    });
  return createSessionLaunchService<WorkflowLaunchAttemptRequest, WorkflowLaunchResult>({
    runtime: deps.runtime,
    // The launch result names the role, so a missing task fails the launch before it starts.
    initial: (request) =>
      deps.taskReader
        .getTask({
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
        })
        .pipe(
          Effect.mapError(
            (cause) => new HostValidationError({ field: "taskId", message: cause.message, cause }),
          ),
          Effect.flatMap((task) =>
            requireInitialLaunchRole(deps.taskWorkflows.forTask(task), request),
          ),
          Effect.map((role) => ({
            workspaceId: request.workspaceId,
            repoPath: request.repoPath,
            taskId: request.taskId,
            role,
            status: "completed" as const,
          })),
        ),
    key: (request) => JSON.stringify([request.workspaceId, request.taskId]),
    target: (request) =>
      request.policy.kind === "manual" && request.policy.decision.startMode === "reuse"
        ? { repoPath: request.repoPath, ...request.policy.decision.sourceSession }
        : undefined,
    run,
  });
};
