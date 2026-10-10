import type { RepoAction, RepoActions, TerminalOwnedContext } from "@openducktor/contracts";
import { Data, Effect, Option } from "effect";
import type {
  StartedCommandTerminal,
  TerminalCommandResult,
  TerminalCommandService,
} from "../terminals/terminal-command";
import { TERMINAL_LIMITS } from "../terminals/terminal-limits";
import type { TerminalServiceError } from "../terminals/terminal-service-error";
import { actionCommandLines, type RepoActionHasNoCommandError } from "./repo-action-command";

const WAIT_LIMIT_MINUTES = 5;

type ActionOutputFields = {
  readonly actionName: string;
  readonly outputTail: readonly string[];
  readonly message: string;
};

/** A waiting action ended with a non-zero status or a signal. */
export class WorktreeActionExitError extends Data.TaggedError("WorktreeActionExitError")<
  ActionOutputFields & { readonly exitCode: number | null; readonly signal: string | null }
> {}

class WorktreeActionTimeoutError extends Data.TaggedError("WorktreeActionTimeoutError")<
  ActionOutputFields & { readonly cause?: TerminalServiceError }
> {}

/** The terminal of a waiting action closed before its command ended. */
class WorktreeActionTerminalClosedError extends Data.TaggedError(
  "WorktreeActionTerminalClosedError",
)<ActionOutputFields> {}

/** The terminal process of a waiting action failed before its command ended. */
class WorktreeActionTerminalFailedError extends Data.TaggedError(
  "WorktreeActionTerminalFailedError",
)<ActionOutputFields & { readonly reason: string }> {}

class WorktreeActionStartError extends Data.TaggedError("WorktreeActionStartError")<{
  readonly actionName: string;
  readonly message: string;
  readonly cause: RepoActionHasNoCommandError | TerminalServiceError;
}> {}

export type WorktreeActionError =
  | WorktreeActionExitError
  | WorktreeActionStartError
  | WorktreeActionTerminalClosedError
  | WorktreeActionTerminalFailedError
  | WorktreeActionTimeoutError;

/** A rollback kept the worktree and its branch, because an action terminal did not stop. */
export class WorktreeKeptForRunningActionsError extends Data.TaggedError(
  "WorktreeKeptForRunningActionsError",
)<{
  readonly worktreePath: string;
  readonly branch: string;
  readonly terminalIds: readonly string[];
  readonly message: string;
  readonly cause: readonly TerminalServiceError[];
}> {}

export type WorktreeActionTerminals = Pick<
  TerminalCommandService,
  "close" | "readOutputTail" | "startCommandInPreparedTarget"
>;

/** The new worktree that a run sets up. */
export type WorktreeActionTarget = { worktreePath: string; branch: string };

export type WorktreeActionRunInput = {
  context: TerminalOwnedContext;
  actions: RepoActions;
};

export type WorktreeActionRun = {
  /** Runs the worktree-creation actions in list order and waits for the waiting actions. */
  run(input: WorktreeActionRunInput): Effect.Effect<void, WorktreeActionError>;
  /**
   * Stops every terminal that the run started, before a rollback removes their worktree. When a
   * terminal does not stop, the rollback must keep the worktree and its branch.
   */
  stopTerminals(): Effect.Effect<void, WorktreeKeptForRunningActionsError>;
};

export type WorktreeActionRunner = {
  /**
   * Creates a run before the worktree setup starts. The run owns each terminal from the moment it
   * starts, so a rollback can stop it after a failure or an interruption.
   */
  createRun(target: WorktreeActionTarget): WorktreeActionRun;
};

export const createWorktreeActionRunner = (
  terminals: WorktreeActionTerminals,
): WorktreeActionRunner => ({
  createRun: ({ worktreePath, branch }) => {
    const terminalIds = new Set<string>();

    // Record the terminal in the same step that starts it, so an interruption cannot hide it. The
    // host starts these terminals, so they do not open the terminal panel.
    const startAction = (
      action: RepoAction,
      context: TerminalOwnedContext,
    ): Effect.Effect<StartedCommandTerminal, WorktreeActionStartError> =>
      actionCommandLines(action).pipe(
        Effect.flatMap((commandLines) =>
          Effect.uninterruptible(
            terminals
              .startCommandInPreparedTarget({
                context,
                workingDir: worktreePath,
                label: action.name,
                commandLines,
                startedBy: "host",
              })
              .pipe(
                Effect.tap((started) =>
                  Effect.sync(() => terminalIds.add(started.response.ref.terminalId)),
                ),
              ),
          ),
        ),
        Effect.mapError(
          (cause) =>
            new WorktreeActionStartError({
              actionName: action.name,
              message: `Worktree action "${action.name}" could not start. ${cause.message}`,
              cause,
            }),
        ),
      );

    const timeoutError = (action: RepoAction, terminalId: string) =>
      terminals.readOutputTail(terminalId, TERMINAL_LIMITS.commandOutputTailLines).pipe(
        Effect.match({
          onSuccess: (outputTail) =>
            new WorktreeActionTimeoutError({
              actionName: action.name,
              outputTail,
              message: actionMessage(action.name, TIMEOUT_SUMMARY, outputTail),
            }),
          onFailure: (cause) =>
            new WorktreeActionTimeoutError({
              actionName: action.name,
              outputTail: [],
              cause,
              message: `${actionMessage(action.name, TIMEOUT_SUMMARY, [])} OpenDucktor could not read its last output: ${cause.message}`,
            }),
        }),
        Effect.flatMap(Effect.fail),
      );

    const awaitAction = (
      action: RepoAction,
      started: StartedCommandTerminal,
    ): Effect.Effect<void, WorktreeActionError> =>
      started.result.pipe(
        Effect.timeoutOption(`${WAIT_LIMIT_MINUTES} minutes`),
        Effect.flatMap(
          Option.match({
            onSome: (result) => requireSuccess(action.name, result),
            onNone: () => timeoutError(action, started.response.ref.terminalId),
          }),
        ),
      );

    return {
      run: ({ context, actions }) =>
        Effect.forEach(
          actions.items.filter((action) => action.runOnWorktreeCreate),
          (action) =>
            startAction(action, context).pipe(
              Effect.flatMap((started) =>
                action.waitBeforeAgentStart ? awaitAction(action, started) : Effect.void,
              ),
            ),
          { discard: true },
        ),
      stopTerminals: () =>
        Effect.gen(function* () {
          const [, failures] = yield* Effect.partition(
            [...terminalIds],
            (terminalId) =>
              terminals.close({ terminalId, confirmTerminate: true }).pipe(
                // A terminal that exited after its command is already gone from the host.
                Effect.catchIf(
                  (failure) => failure.code === "terminal_not_found",
                  () => Effect.void,
                ),
                Effect.tap(() => Effect.sync(() => terminalIds.delete(terminalId))),
                Effect.mapError((failure) => ({ terminalId, failure })),
              ),
            { concurrency: "unbounded" },
          );
          if (failures.length > 0) {
            return yield* new WorktreeKeptForRunningActionsError({
              worktreePath,
              branch,
              terminalIds: failures.map(({ terminalId }) => terminalId),
              message: `Failed to stop worktree action terminals: ${failures.map(({ failure }) => failure.message).join("; ")}\nOpenDucktor kept the worktree at ${worktreePath} and the branch ${branch}, because an action terminal still runs there. Close that terminal or restart OpenDucktor, then remove the worktree and the branch.`,
              cause: failures.map(({ failure }) => failure),
            });
          }
        }),
    };
  },
});

const actionMessage = (actionName: string, summary: string, outputTail: readonly string[]) =>
  `Worktree action "${actionName}" ${summary}${
    outputTail.length > 0 ? `\nLast output:\n${outputTail.join("\n")}` : ""
  }`;

const TIMEOUT_SUMMARY = `did not finish within ${WAIT_LIMIT_MINUTES} minutes, so OpenDucktor stopped it.`;

const requireSuccess = (
  actionName: string,
  result: TerminalCommandResult,
): Effect.Effect<void, WorktreeActionError> => {
  const { outputTail } = result;
  switch (result.type) {
    case "exited":
      // A signal can end the command while node-pty still reports exit code 0.
      if (result.exitCode === 0 && result.signal === null) return Effect.void;
      return Effect.fail(
        new WorktreeActionExitError({
          actionName,
          exitCode: result.exitCode,
          signal: result.signal,
          outputTail,
          message: actionMessage(
            actionName,
            result.signal === null
              ? `exited with code ${result.exitCode ?? "unknown"}.`
              : `stopped with signal ${result.signal}.`,
            outputTail,
          ),
        }),
      );
    case "closed":
      return Effect.fail(
        new WorktreeActionTerminalClosedError({
          actionName,
          outputTail,
          message: actionMessage(
            actionName,
            "stopped because its terminal closed before the command ended.",
            outputTail,
          ),
        }),
      );
    case "failed":
      return Effect.fail(
        new WorktreeActionTerminalFailedError({
          actionName,
          reason: result.message,
          outputTail,
          message: actionMessage(
            actionName,
            `stopped because its terminal failed. ${result.message}`,
            outputTail,
          ),
        }),
      );
  }
};
