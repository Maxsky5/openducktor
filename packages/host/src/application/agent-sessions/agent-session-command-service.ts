import type { AgentSessionWorkflowScope } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { AgentSessionMessageAcceptedError } from "../../ports/agent-session-send-error";
import type {
  AgentSessionOperationPolicy,
  PreparedSessionModelUpdate,
} from "./agent-session-operation-policy";
import { createTaskWorkflowSessionPolicy } from "./task-workflow-session-policy";
import { resumeAndSaveSession } from "./session-resume";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";

type ObservedSessionCommands = Pick<
  AgentSessionLiveStateService,
  "continueInterruptedTurn" | "loadContext" | "loadSessionDiff" | "replyApproval" | "replyQuestion"
>;

export const createAgentSessionCommandService = ({
  repositoryPolicy,
  ...dependencies
}: Parameters<typeof createTaskWorkflowSessionPolicy>[0] & {
  repositoryPolicy: AgentSessionOperationPolicy;
  runtime: Parameters<typeof createTaskWorkflowSessionPolicy>[0]["runtime"] &
    ObservedSessionCommands;
}) => {
  const { runtime, canonicalizeRepoPath } = dependencies;
  const workflow = createTaskWorkflowSessionPolicy(dependencies);
  const policyFor = (scope: { kind: "repository" } | AgentSessionWorkflowScope) =>
    scope.kind === "workflow" ? workflow.forScope(scope) : repositoryPolicy;

  const updateModel = (prepared: PreparedSessionModelUpdate) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        yield* runtime.updateSessionModel(prepared.input);
        const saved = yield* Effect.result(prepared.save);
        if (saved._tag === "Success") {
          yield* saved.success;
          return;
        }
        const restored = yield* Effect.result(
          runtime.updateSessionModel({
            ...prepared.input,
            model: prepared.previousModel,
          }),
        );
        if (restored._tag === "Failure") {
          return yield* new HostOperationError({
            operation: "agent-session.update-model",
            message: `${saved.failure.message} Runtime model restore failed: ${restored.failure.message}`,
            cause: { storeFailure: saved.failure, restoreFailure: restored.failure },
            details: {
              ref: prepared.input,
              storeFailure: saved.failure,
              restoreFailure: restored.failure,
            },
          });
        }
        return yield* Effect.fail(saved.failure);
      }),
    );

  return {
    ...runtime,
    startWorkflowSession: workflow.startWorkflowSession,
    forkSession: workflow.forkSession,
    loadContext: (input: Parameters<typeof runtime.loadContext>[0]) =>
      repositoryPolicy.run(
        input,
        "load session context",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.loadContext(input))),
      ),
    loadSessionDiff: (input: Parameters<typeof runtime.loadSessionDiff>[0]) =>
      repositoryPolicy.run(
        input,
        "load session diff",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.loadSessionDiff(input))),
      ),
    replyApproval: (input: Parameters<typeof runtime.replyApproval>[0]) =>
      repositoryPolicy.run(
        input,
        "reply to approval",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.replyApproval(input))),
      ),
    replyQuestion: (input: Parameters<typeof runtime.replyQuestion>[0]) =>
      repositoryPolicy.run(
        input,
        "reply to question",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.replyQuestion(input))),
      ),
    stopSession: (input: Parameters<typeof runtime.stopSession>[0]) =>
      repositoryPolicy.run(input, "stop session", runtime.stopSession(input)),
    releaseSession: (input: Parameters<typeof runtime.releaseSession>[0]) =>
      repositoryPolicy.run(input, "release session", runtime.releaseSession(input)),
    resumeSession: (input: Parameters<typeof runtime.resumeSession>[0]) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* policy.run(
          ref,
          "resume session",
          Effect.gen(function* () {
            const prepared = yield* policy.prepareResume(ref);
            if (input.resumeMode === "continue_interrupted_turn") {
              const { resumeMode: _resumeMode, ...continuationInput } = prepared.input;
              return yield* runtime.continueInterruptedTurn(continuationInput);
            }
            return yield* resumeAndSaveSession({
              ref,
              resume: runtime.resumeSession(prepared.input),
              save: prepared.save,
              release: runtime.releaseSession,
            }).pipe(Effect.map(({ session }) => session));
          }),
        );
      }),
    sendUserMessage: (input: Parameters<typeof runtime.sendUserMessage>[0]) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* policy.runSend(
          ref,
          Effect.gen(function* () {
            const prepared = yield* policy.prepareSend(ref);
            const accepted = yield* runtime.sendUserMessage(prepared);
            yield* policy.recordAcceptedMessage(ref, accepted).pipe(
              Effect.mapError(
                (cause) =>
                  new AgentSessionMessageAcceptedError(
                    {
                      sessionRef: {
                        repoPath,
                        runtimeKind: ref.runtimeKind,
                        workingDirectory: ref.workingDirectory,
                        externalSessionId: ref.externalSessionId,
                      },
                      acceptedMessage: accepted,
                      stage: "record_message",
                    },
                    cause,
                  ),
              ),
            );
            return accepted;
          }),
        );
      }),
    updateSessionModel: (input: Parameters<typeof runtime.updateSessionModel>[0]) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* policy.run(
          ref,
          "change session model",
          policy.prepareModelUpdate(ref).pipe(Effect.flatMap(updateModel)),
        );
      }),
  };
};
