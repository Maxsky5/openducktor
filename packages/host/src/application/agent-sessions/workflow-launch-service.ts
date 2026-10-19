import type {
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import { getSessionLaunchAction } from "@openducktor/core";
import { Effect } from "effect";
import type { TaskServiceError } from "../tasks/task-service";
import { createSessionLaunchService } from "./session-launch-service";
import type { SessionLaunchContext } from "./session-launch-types";
import type { TaskSessionProgress } from "./task-session-operations";
import { toControlSessionRef } from "./task-workflow-session-storage";
import {
  prepareWorkflowLaunch,
  resolveLaunchWorkspace,
  workflowActionId,
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
      const { config, repoPath } = yield* resolveLaunchWorkspace(deps, request);
      const prepared = yield* prepareWorkflowLaunch(
        deps,
        request,
        repoPath,
        config,
        attempt.targetSession,
      );
      if (prepared.kind === "skipped") {
        attempt.skip(prepared.reason);
        return;
      }
      yield* attempt.checkCanceled();
      const { decision, action, model, systemPrompt, parts } = prepared;
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
          ({ session, publish } = yield* deps.sessions.resume(resumeInput));
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
        yield* publish;
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
    sendInstruction: (request, input, options) => {
      if (request.policy.kind !== "automatic") return deps.runtime.sendUserMessage(input, options);
      return deps.messageDelivery
        .submit({
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: input.workingDirectory,
          externalSessionId: input.externalSessionId,
          sessionScope: input.sessionScope,
          parts: input.parts,
          submissionId: crypto.randomUUID(),
          mode: "default",
        })
        .pipe(
          Effect.map((result) => (result.kind === "accepted" ? result.acceptedMessage : undefined)),
        );
    },
    initial: (request) => ({
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      taskId: request.taskId,
      role: getSessionLaunchAction(workflowActionId(request)).role,
      status: "completed",
    }),
    key: (request) => JSON.stringify([request.workspaceId, request.taskId]),
    target: (request) =>
      request.policy.kind === "manual" && request.policy.decision.startMode === "reuse"
        ? { repoPath: request.repoPath, ...request.policy.decision.sourceSession }
        : undefined,
    run,
  });
};
