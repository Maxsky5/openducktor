import type {
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { finalizeStartup, startupStep, updateStartup } from "./session-startup-progress";
import type { TaskServiceError } from "../tasks/task-service";
import { createSessionLaunchService } from "./session-launch-service";
import type { SessionLaunchContext } from "./session-launch-types";
import type { TaskSessionProgress } from "./task-session-operations";
import { toControlSessionRef } from "./task-workflow-session-storage";
import {
  prepareWorkflowLaunch,
  resolveLaunchWorkspace,
  requireLaunchAction,
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
      const { decision, action, model, systemPrompt, parts } = prepared;
      if (parts !== undefined)
        attempt.keepInstruction(
          request.instruction.kind === "message" ? request.instruction.parts : parts,
        );
      attempt.setResultFields({ startMode: decision.startMode });
      if (model) attempt.setResultFields({ model });
      const sessionScope = {
        kind: "workflow" as const,
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
      if (decision.startMode === "fresh") {
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
        session = { ...decision.sourceSession, startedAt: source.startedAt, status: "idle" };
        attempt.reusedSession(repoPath, session);
        yield* updateStartup((progress) =>
          progress.ownership({
            state: "saved",
            target: { kind: "task", record: source, runtimeSession: session },
          }),
        );
        if (live.type !== "live") {
          const resumeInput: AgentSessionControlResumeInput &
            import("@openducktor/core").AgentWorkStartOptions = {
            repoPath,
            ...decision.sourceSession,
            sessionScope,
            resumeMode: "reattach",
            systemPrompt,
            workStartGuard: { assertCurrent: attempt.assertCurrent },
          };
          if (model) resumeInput.model = model;
          ({ session, publish } = yield* startupStep(
            { id: "prepare", label: "Resume native session" },
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
          repoPath,
          taskId: request.taskId,
        });
        // Readers bind the saved owner with its live activity before the first instruction.
        yield* deps.runtime.publishTaskSessionRecords(toControlSessionRef(repoPath, session), {
          taskId: request.taskId,
          agentSessions,
        });
      }
      if (
        request.policy.kind === "manual" &&
        request.instruction.kind === "none" &&
        request.startup !== undefined &&
        decision.startMode === "reuse"
      )
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
      yield* attempt.send(
        input,
        request.instruction.kind === "message" ? request.instruction.parts : parts,
      );
    });
  return createSessionLaunchService<WorkflowLaunchAttemptRequest, WorkflowLaunchResult>({
    runtime: deps.runtime,
    send: (request, input, options) => {
      if (request.policy.kind !== "automatic") return deps.runtime.sendUserMessage(input, options);
      return deps.messageDelivery
        .submit(
          {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
            sessionScope: input.sessionScope,
            parts: input.parts,
            submissionId: crypto.randomUUID(),
            mode: "default",
          },
          options,
        )
        .pipe(
          Effect.map((result) => (result.kind === "accepted" ? result.acceptedMessage : undefined)),
        );
    },
    initial: (request) =>
      // A missing task fails in the launch, which reports it in the result.
      requireLaunchAction(deps.taskWorkflows.forTask({ id: request.taskId }), request).pipe(
        Effect.map(({ role }) => ({
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
