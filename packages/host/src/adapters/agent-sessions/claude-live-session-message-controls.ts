import {
  type AcceptedAgentInput,
  type AcceptedAgentUserMessage,
  type AgentSessionControlSendInput,
  acceptedAgentUserMessageSchema,
  goalCommandParts,
} from "@openducktor/contracts";
import { GOAL_COMMAND_ACCEPTED } from "@openducktor/core";
import { Effect } from "effect";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  AgentSessionControlAdapterPort,
  AgentSessionControlGoalInput,
  AgentSessionLiveAdapterMutation,
  AgentSessionSendOptions,
} from "../../ports/agent-session-live-adapter-port";
import { messageAcceptedFailure } from "../../ports/agent-session-send-error";
import {
  beginClaudeGoalCommand,
  type ClaudeGoalCommand,
  currentClaudeGoalEvent,
  forgetEndedClaudeGoal,
  restoreClaudeSessionGoal,
} from "../claude/claude-agent-sdk-goals";
import { canStartUserTurn } from "../claude/claude-agent-sdk-turn-policy";
import type { ClaudeLiveEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import { parseClaudeLiveSessionOutput } from "./claude-live-session-runtime-guards";
import { toClaudeRuntimeUserMessageEvent } from "./claude-live-session-service-inputs";
import type { createClaudeLiveSessionState } from "./claude-live-session-state";

type SendControls = Pick<AgentSessionSendOptions, "assertCurrent" | "onSent">;
type GoalTarget = Omit<AgentSessionControlGoalInput, "command">;

/** The message and goal controls of the Claude live-session adapter. */
export const createClaudeMessageControls = ({
  commit,
  runControlMutation,
  requireSessionContext,
  send,
  state,
}: {
  commit: <Value>(
    operation: string,
    mutation: () => AgentSessionLiveAdapterMutation<Value>,
  ) => Effect.Effect<Value, HostError>;
  runControlMutation: <Value>(
    effect: Effect.Effect<Value, HostError>,
  ) => Effect.Effect<Value, HostError>;
  requireSessionContext: (
    externalSessionId: string,
  ) => Effect.Effect<ClaudeSessionContext, HostError>;
  /** Sends one message through the Claude service. */
  send: (
    input: AgentSessionControlSendInput,
    options?: SendControls,
  ) => Effect.Effect<AcceptedAgentUserMessage, HostError>;
  state: ReturnType<typeof createClaudeLiveSessionState>;
}) => {
  /** Sends one message and publishes its accepted user message. */
  const sendAndPublish = (
    input: AgentSessionControlSendInput,
    options?: SendControls,
  ): Effect.Effect<AcceptedAgentUserMessage, HostError> =>
    Effect.suspend(() => {
      let acceptedMessage: AcceptedAgentUserMessage | null = null;
      return runControlMutation(
        Effect.gen(function* () {
          const output = yield* send(input, options);
          const accepted = yield* parseClaudeLiveSessionOutput(
            acceptedAgentUserMessageSchema,
            output,
            "claude-live-session.normalize-user-message",
          );
          acceptedMessage = accepted;
          const session = yield* requireSessionContext(input.externalSessionId);
          return yield* commit("claude-live-session.publish-user-message", () => {
            state.reactivateSession(input);
            return {
              value: accepted,
              changes: state.applyEvent(session, toClaudeRuntimeUserMessageEvent(accepted)),
            };
          });
        }),
      ).pipe(
        Effect.mapError((cause) =>
          acceptedMessage
            ? messageAcceptedFailure(input, acceptedMessage, "live_update")(cause)
            : cause,
        ),
      );
    });

  const publishGoal = (session: ClaudeSessionContext, event: ClaudeLiveEvent) =>
    commit("claude-live-session.publish-goal", () => ({
      value: undefined,
      changes: state.applyEvent(session, event),
    }));

  /**
   * Sends a Claude `/goal` command and waits until Claude reports its outcome. Claude never runs
   * a slash command inside a running turn, so a command during a goal turn uses priority `now`,
   * which stops the turn and then sets or clears the goal. The goal shows as clearing until the clear ends, so
   * the command turn of the clear does not show it as active.
   */
  const runGoalCommand = (
    input: GoalTarget,
    command: ClaudeGoalCommand,
    options?: SendControls,
  ): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      const session = yield* requireSessionContext(input.externalSessionId);
      const wait = yield* Effect.try({
        try: () => beginClaudeGoalCommand(session, command),
        catch: (cause) => toHostOperationError(cause, "claude-live-session.goal"),
      });
      const sendInput: AgentSessionControlSendInput = {
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        sessionScope: input.sessionScope,
        parts: goalCommandParts(command.kind === "set" ? command.objective : "clear"),
        delivery: canStartUserTurn(session) ? "new_turn" : "steer",
      };
      if (input.systemPrompt !== undefined) sendInput.systemPrompt = input.systemPrompt;
      if (input.submissionId !== undefined) sendInput.submissionId = input.submissionId;
      // Observe the outcome now: a failed send cancels the wait, and the send error then reports it.
      const outcome = wait.outcome.then(
        () => null,
        (cause: unknown) => cause,
      );
      const publishCurrentGoal = () =>
        publishGoal(session, currentClaudeGoalEvent(session, new Date().toISOString()));
      const result = yield* Effect.gen(function* () {
        if (command.kind === "clear") yield* publishCurrentGoal();
        yield* sendAndPublish(sendInput, options);
        const failure = yield* Effect.promise(() => outcome);
        if (failure === null) return;
        return yield* Effect.fail(
          failure instanceof HostValidationError
            ? failure
            : toHostOperationError(failure, "claude-live-session.goal", {
                externalSessionId: input.externalSessionId,
              }),
        );
      }).pipe(
        // A failed or interrupted send ends the wait. After an outcome, cancel does nothing.
        Effect.ensuring(Effect.sync(wait.cancel)),
        Effect.exit,
      );
      // A failed clear keeps the goal, which is no longer clearing.
      if (command.kind === "clear") yield* publishCurrentGoal();
      return yield* result;
    });

  return {
    sendUserMessage: sendAndPublish,
    controlGoal: (
      input: Parameters<AgentSessionControlAdapterPort["controlGoal"]>[0],
      options?: SendControls,
    ): Effect.Effect<AcceptedAgentInput, HostError> =>
      requireSessionContext(input.externalSessionId).pipe(
        Effect.flatMap((session) => {
          const { command } = input;
          if (command.kind === "pause" || command.kind === "resume")
            return Effect.fail(
              new HostValidationError({
                field: "command",
                message: `Claude cannot ${command.kind} a goal.`,
              }),
            );
          if (command.kind === "clear") {
            const forgotten = forgetEndedClaudeGoal(session, new Date().toISOString());
            if (forgotten) return publishGoal(session, forgotten);
          }
          return runGoalCommand(input, command, options);
        }),
        Effect.as(GOAL_COMMAND_ACCEPTED),
      ),
    /**
     * Publishes the goal that Claude restores for a resumed, continued, or forked session. A
     * failed read keeps the session and reports the failure on it.
     */
    restoreGoal: (repoPath: string, externalSessionId: string) =>
      requireSessionContext(externalSessionId).pipe(
        Effect.flatMap((session) =>
          Effect.tryPromise({
            try: () => restoreClaudeSessionGoal(session, new Date().toISOString()),
            catch: (cause) =>
              toHostOperationError(cause, "claude-live-session.restore-goal", {
                externalSessionId,
              }),
          }).pipe(
            Effect.flatMap((event) => publishGoal(session, event)),
            Effect.catch((failure) =>
              commit("claude-live-session.report-goal-failure", () => ({
                value: undefined,
                changes: [
                  {
                    type: "fault",
                    repoPath,
                    operation: "claude-live-session.restore-goal",
                    message: failure.message,
                    ref: {
                      repoPath,
                      runtimeKind: "claude",
                      workingDirectory: session.input.workingDirectory,
                      externalSessionId,
                    },
                  },
                ],
              })),
            ),
          ),
        ),
      ),
  };
};
