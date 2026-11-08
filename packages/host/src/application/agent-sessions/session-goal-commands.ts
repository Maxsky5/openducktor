import type {
  AgentSessionGoalControlInput,
  AgentSessionLiveRef,
  AgentSessionScope,
  AgentSessionUserMessagePart,
} from "@openducktor/contracts";
import { type AgentSessionGoalCommand, goalCommandStartsWork } from "@openducktor/core";
import { classifySessionMessageSystemCommand } from "./session-message-system-command";
import { Effect } from "effect";
import {
  errorMessage,
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionSendOptions } from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type {
  AgentSessionOperationPolicy,
  AgentSessionSendContent,
} from "./agent-session-operation-policy";
import type { SessionGoalRules } from "./session-goal-rules";
import type { createSessionOperationOwner } from "./session-operation-owner";
import { deliverWithOwner } from "./session-owner-delivery";
import type { createSessionTurnPreparation } from "./session-turn-preparation";

/** The `/goal` messages and the goal row actions of the session command service. */
export const createSessionGoalCommands = ({
  goalRules,
  owner,
  runtime,
  turnPreparation,
  checkPending,
  canonicalizeRepoPath,
  policyFor,
}: {
  goalRules: SessionGoalRules;
  owner: ReturnType<typeof createSessionOperationOwner>;
  runtime: Pick<AgentSessionLiveStateService, "controlGoal">;
  turnPreparation: Pick<ReturnType<typeof createSessionTurnPreparation>, "context">;
  checkPending: (ref: AgentSessionLiveRef) => Effect.Effect<unknown, HostError>;
  canonicalizeRepoPath: (repoPath: string) => Effect.Effect<string, HostError>;
  policyFor: (scope: AgentSessionScope) => AgentSessionOperationPolicy;
}) => {
  /** The goal command of a `/goal` message, or `null` for another message. */
  const commandOf = (parts: AgentSessionUserMessagePart[]) =>
    Effect.try({
      try: () => {
        const invocation = classifySessionMessageSystemCommand(parts);
        return invocation.kind === "goal" ? invocation.command : null;
      },
      catch: (cause) =>
        new HostValidationError({
          field: "parts",
          message: errorMessage(cause),
          cause,
        }),
    });

  const requireAllowed = (ref: AgentSessionLiveRef, command: AgentSessionGoalCommand) =>
    goalRules
      .blockedReason(ref.runtimeKind, command)
      .pipe(
        Effect.flatMap((reason) =>
          reason === null
            ? Effect.void
            : Effect.fail(new HostValidationError({ field: "parts", message: reason })),
        ),
      );

  /** Runs a `/goal` message as a native goal action inside its submission. */
  const send = (
    content: AgentSessionSendContent,
    command: AgentSessionGoalCommand,
    steering: boolean,
    options?: Pick<AgentSessionSendOptions, "onSent">,
  ) =>
    Effect.gen(function* () {
      if (steering)
        return yield* new HostValidationError({
          field: "delivery",
          message: "A slash command cannot join running work.",
        });
      yield* requireAllowed(content, command);
      const systemPrompt =
        command.kind === "set"
          ? ((yield* turnPreparation.context(content)) ?? content.systemPrompt)
          : undefined;
      yield* checkPending(content);
      const input = {
        repoPath: content.repoPath,
        runtimeKind: content.runtimeKind,
        workingDirectory: content.workingDirectory,
        externalSessionId: content.externalSessionId,
        sessionScope: content.sessionScope,
        command,
        systemPrompt,
        submissionId: content.submissionId,
      };
      return yield* deliverWithOwner(
        owner,
        content,
        (guard) =>
          runtime.controlGoal(input, guard).pipe(
            // Pause and clear end no turn, so the queue can send its next message at once.
            Effect.map((native) =>
              native.type === "command_accepted"
                ? { ...native, startsTurn: goalCommandStartsWork(command) }
                : native,
            ),
          ),
        options?.onSent,
      );
    });

  /**
   * A goal row action. It neither holds the submission nor changes the message queue. A Stop
   * after the action starts cancels an action that starts work, so Resume cannot outlive Stop.
   */
  const applyAction = (input: AgentSessionGoalControlInput) =>
    owner.supervise(
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const { action, ...target } = input;
        const ref = { ...target, repoPath };
        const command: AgentSessionGoalCommand = { kind: action };
        const guard = goalCommandStartsWork(command) ? owner.captureGuard(ref) : undefined;
        const root = yield* owner.root(ref);
        yield* requireAllowed(ref, command);
        const policy = policyFor(root.sessionScope);
        return yield* policy.run(
          ref,
          `${action} goal`,
          Effect.gen(function* () {
            // The policy refuses a chat that the user archived.
            yield* policy.validateRef(ref);
            if (guard)
              yield* Effect.try({
                try: guard.assertCurrent,
                catch: (cause) => toHostOperationError(cause, "session.goal"),
              });
            return yield* runtime
              .controlGoal({ ...ref, command }, { assertCurrent: guard?.assertCurrent })
              .pipe(Effect.asVoid);
          }),
        );
      }),
    );

  return { commandOf, requireAllowed, send, applyAction };
};
