import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalCreateResponse,
  type TerminalSummary,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import { createSerialLane } from "../../effect/serial-gate";
import type {
  TerminalPtyError,
  TerminalPtyExit,
  TerminalPtyHandlers,
  TerminalPtyLaunchPlan,
  TerminalPtyPort,
} from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import type { TerminalCommandLaunchPlans } from "./terminal-launch-policy";
import { TerminalServiceError } from "./terminal-service-error";
import {
  activateTerminalSession,
  copyTerminalSummary,
  createTerminalSession,
  forgetTerminalSession,
  isLiveTerminal,
  settleCommandRun,
  settleCommandRunAfterOutput,
  type TerminalCommandRun,
  type TerminalSession,
} from "./terminal-session";
import type {
  StartedCommandTerminal,
  TerminalCommandLines,
  TerminalCommandRequest,
} from "./terminal-command";
import { type createTerminalSessionLifecycle, terminalFailure } from "./terminal-session-lifecycle";
import type { TerminalTitleSettlementScheduler } from "./terminal-title-settler";
import { createTerminalTitleTracker } from "./terminal-title-tracker";
import type { createTerminalActivity } from "./terminal-activity";
import { createTerminalCommandTracker } from "./terminal-command-tracker";
import { COMMAND_BUFFER_ERROR, COMMAND_READY_ERROR, commandInput } from "./terminal-command-input";

/** The command that a command terminal runs before it continues in a shell. */
type CommandPhase = {
  lines: TerminalCommandLines;
  plan: TerminalPtyLaunchPlan;
  run: TerminalCommandRun;
};

export const createTerminalSessionProducer = ({
  sessions,
  ptyPort,
  lifecycle,
  activity,
  scheduleTitleSettlement,
}: {
  sessions: Map<string, TerminalSession>;
  ptyPort: TerminalPtyPort;
  lifecycle: ReturnType<typeof createTerminalSessionLifecycle>;
  activity: ReturnType<typeof createTerminalActivity>;
  scheduleTitleSettlement: TerminalTitleSettlementScheduler | undefined;
}) => {
  const { applyStreamEvents, handleExit, handleFailure } = lifecycle;
  const publishTitle = (session: TerminalSession, title: string): void => {
    // A command terminal keeps its command label.
    if (session.commandRun || title === session.summary.label) return;
    session.summary.label = title;
    activity.changed(session);
    applyStreamEvents(
      session,
      session.output.publish({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "title",
        terminalId: session.summary.terminalId,
        title,
      }),
    );
  };

  const acceptOutput = (session: TerminalSession, data: Uint8Array): void => {
    if (sessions.get(session.summary.terminalId) !== session || !isLiveTerminal(session)) return;
    session.resources.consumeOutput(data);
    if (session.screen.queuedBytes + data.byteLength > TERMINAL_LIMITS.replayBytes) {
      applyStreamEvents(session, [{ type: "overflow" }]);
      return;
    }
    session.screen.write(data, () => {
      applyStreamEvents(
        session,
        session.output.updateParserBacklog(session.screen.queuedBytes, session.resources.handle),
      );
    });
    applyStreamEvents(session, session.output.accept(data, session.resources.handle));
    applyStreamEvents(
      session,
      session.output.updateParserBacklog(session.screen.queuedBytes, session.resources.handle),
    );
  };

  const publishPtyFailure = (session: TerminalSession, failure: TerminalPtyError): void => {
    applyStreamEvents(
      session,
      session.output.publishFailure({
        code: failure.code === "operation_failed" ? "protocol_error" : failure.code,
        message: `${failure.message} Close this tab and create a new terminal after resolving the error.`,
        terminalId: session.summary.terminalId,
        workingDir: session.summary.initialWorkingDir,
      }),
    );
  };

  const failCommand = (session: TerminalSession, failure: TerminalPtyError): void => {
    publishPtyFailure(session, failure);
    settleCommandRunAfterOutput(session, (outputTail) => ({
      type: "failed",
      message: failure.message,
      outputTail,
    }));
    handleFailure(session);
  };

  const shellHandlers = (session: TerminalSession): TerminalPtyHandlers => ({
    onOutput: (data) => acceptOutput(session, data),
    onFailure: (failure) => {
      publishPtyFailure(session, failure);
      handleFailure(session);
    },
    onExit: ({ exitCode, signal }) => handleExit(session, exitCode, signal),
  });

  const startShellAfterCommand = (session: TerminalSession, plan: TerminalPtyLaunchPlan) =>
    Effect.gen(function* () {
      if (
        sessions.get(session.summary.terminalId) !== session ||
        session.summary.lifecycle !== "running"
      )
        return;
      const started = yield* Effect.result(
        ptyPort.start({ ...plan, grid: session.grid }, shellHandlers(session)),
      );
      if (started._tag === "Failure") {
        publishPtyFailure(session, started.failure);
        handleExit(session, null, null);
        return;
      }
      const handle = started.success;
      if (!session.resources.activate(handle)) {
        // The session ended during the start. Stop the new shell and report a failed stop.
        yield* handle
          .terminate()
          .pipe(Effect.catch((failure) => Effect.sync(() => publishPtyFailure(session, failure))));
        return;
      }
      activity.changed(session);
      applyStreamEvents(
        session,
        yield* session.output
          .pauseIfRequested(handle)
          .pipe(Effect.catch(() => Effect.succeed([{ type: "overflow" as const }]))),
      );
    });

  const commandHandlers = (
    session: TerminalSession,
    command: CommandPhase,
    shell: TerminalPtyLaunchPlan,
  ): TerminalPtyHandlers => ({
    onOutput: (data) => acceptOutput(session, data),
    onFailure: (failure) => failCommand(session, failure),
    onExit: (exit) => {
      if (command.plan.interactiveCommand === undefined) {
        finishCommand(session, exit, command, shell);
        return;
      }
      if (session.summary.lifecycle === "starting" || session.summary.lifecycle === "running") {
        settleCommandRunAfterOutput(session, (outputTail) => ({
          type: "exited",
          exitCode: exit.exitCode,
          signal: exit.signal,
          outputTail,
        }));
      }
      handleExit(session, exit.exitCode, exit.signal);
    },
  });

  const finishCommand = (
    session: TerminalSession,
    exit: TerminalPtyExit,
    command: CommandPhase,
    shell: TerminalPtyLaunchPlan,
  ): void => {
    const lifecycle = session.summary.lifecycle;
    if (
      sessions.get(session.summary.terminalId) !== session ||
      (lifecycle !== "starting" && lifecycle !== "running")
    ) {
      // A close or an overflow stop ended the command.
      handleExit(session, exit.exitCode, exit.signal);
      return;
    }
    command.run.phase = "shell";
    session.command = null;
    activity.changed(session);
    Effect.runFork(
      Effect.gen(function* () {
        session.resources.releaseHandle();
        yield* session.output.clearProducerPause();
        yield* Effect.promise(() => session.screen.drained());
        // A close during the handoff already settled the result and releases the screen.
        if (sessions.get(session.summary.terminalId) !== session) return;
        settleCommandRun(session, (outputTail) => ({
          type: "exited",
          exitCode: exit.exitCode,
          signal: exit.signal,
          outputTail,
        }));
        yield* startShellAfterCommand(session, shell);
      }).pipe(session.operations.run),
    );
  };

  const startSession = (
    summary: TerminalSummary,
    shellPlan: TerminalPtyLaunchPlan,
    command: CommandPhase | null,
  ): Effect.Effect<TerminalSession, TerminalServiceError> =>
    // Keep startup and handle handoff together so cancellation cannot orphan the PTY.
    Effect.uninterruptible(
      Effect.gen(function* () {
        let session: TerminalSession;
        const titleTracker = createTerminalTitleTracker(
          (title) => publishTitle(session, title),
          scheduleTitleSettlement,
        );
        session = createTerminalSession({
          summary,
          titleTracker,
          operations: createSerialLane(),
          replayByteLimit: TERMINAL_LIMITS.replayBytes,
          shell: shellPlan.shell,
          grid: shellPlan.grid,
          command:
            command?.lines.join("; ").slice(0, TERMINAL_LIMITS.activityCommandLength) ?? null,
          commandRun: command?.run ?? null,
        });
        sessions.set(summary.terminalId, session);
        const commandNonce = globalThis.crypto.randomUUID();
        const interactiveCommand = command?.plan.interactiveCommand;
        if (interactiveCommand !== undefined) session.inputOwner = "action";
        let lineIndex = 0;
        let lineDone: Deferred.Deferred<void> | null = null;
        session.screen.onOsc(
          633,
          createTerminalCommandTracker(commandNonce, (activityCommand, details) => {
            if (details.ready !== undefined) {
              Deferred.doneUnsafe(session.ready, Effect.succeed(details.ready));
              return;
            }
            if (activityCommand !== null) {
              session.ready = Deferred.makeUnsafe();
              session.runningCommand = details.input;
              session.command = activityCommand;
            } else {
              if (interactiveCommand !== undefined && command?.run.phase === "command") {
                if (lineDone === null || session.summary.lifecycle !== "running") return;
                const done = lineDone;
                lineDone = null;
                if (
                  details.exitCode === 0 &&
                  lineIndex + 1 < command.lines.length &&
                  !command.run.stopRequested
                ) {
                  lineIndex += 1;
                  session.inputOwner = "action";
                } else {
                  command.run.phase = "shell";
                  settleCommandRunAfterOutput(session, (outputTail) => ({
                    type: "exited",
                    exitCode: details.exitCode,
                    signal: null,
                    outputTail,
                  }));
                }
                Deferred.doneUnsafe(done, Effect.void);
              }
              session.runningCommand = null;
              session.command = null;
            }
            activity.changed(session);
          }),
        );
        activity.changed(session);
        const shell = { ...shellPlan, commandNonce };
        if (command && interactiveCommand === undefined)
          acceptOutput(session, formatCommandEcho(command.lines));
        let plan: TerminalPtyLaunchPlan = shell;
        let handlers = shellHandlers(session);
        if (command) {
          plan =
            interactiveCommand === undefined
              ? { ...command.plan, runsCommand: true }
              : { ...command.plan, commandNonce };
          handlers = commandHandlers(session, command, shell);
        }
        const handleResult = yield* Effect.result(
          ptyPort.start(plan, handlers).pipe(
            Effect.tap((handle) =>
              Effect.sync(() => {
                activateTerminalSession(session, handle);
                activity.changed(session);
              }),
            ),
            session.operations.run,
          ),
        );
        if (handleResult._tag === "Failure") {
          forgetTerminalSession(session);
          sessions.delete(summary.terminalId);
          activity.remove(summary.terminalId);
          return yield* terminalFailure(
            handleResult.failure.code === "unsupported_runtime"
              ? "unsupported_runtime"
              : "spawn_failed",
            "create",
            handleResult.failure.message,
            summary.terminalId,
            handleResult.failure,
          );
        }
        if (command && interactiveCommand !== undefined) {
          const releaseInput = Effect.sync(() => {
            if (session.inputOwner === "action") session.inputOwner = null;
          });
          const submitLines = Effect.gen(function* () {
            while (command.run.phase === "command") {
              const ready = yield* Effect.result(
                Deferred.await(session.ready).pipe(Effect.timeout("10 seconds")),
              );
              const done = Deferred.makeUnsafe<void>();
              yield* session.operations.run(
                Effect.suspend(() => {
                  const handle = session.resources.handle;
                  if (!handle || session.summary.lifecycle !== "running") return Effect.void;
                  let message: string | null = null;
                  if (ready._tag === "Failure") message = COMMAND_READY_ERROR;
                  else if (!ready.success) message = COMMAND_BUFFER_ERROR;
                  if (message !== null) {
                    command.run.phase = "shell";
                    session.command = null;
                    acceptOutput(session, new TextEncoder().encode(`\r\n${message}\r\n`));
                    settleCommandRunAfterOutput(session, (outputTail) => ({
                      type: "failed",
                      message,
                      outputTail,
                    }));
                    activity.changed(session);
                    return Effect.void;
                  }
                  const input = command.lines[lineIndex]!;
                  lineDone = done;
                  return handle.write(commandInput(input)).pipe(
                    Effect.catch((failure) => Effect.sync(() => failCommand(session, failure))),
                    Effect.ensuring(releaseInput),
                  );
                }),
              );
              yield* Deferred.await(done);
            }
          });
          const submission = yield* Effect.forkDetach(
            Effect.raceFirst(
              submitLines,
              Deferred.await(command.run.result).pipe(Effect.asVoid),
            ).pipe(Effect.ensuring(releaseInput)),
            { startImmediately: true },
          );
          session.resources.ownSubmission(submission);
        }
        return session;
      }),
    );

  const createResponse = (session: TerminalSession): TerminalCreateResponse => ({
    ref: { terminalId: session.summary.terminalId },
    summary: copyTerminalSummary(session),
  });

  return {
    startShell: (
      summary: TerminalSummary,
      plan: TerminalPtyLaunchPlan,
    ): Effect.Effect<TerminalCreateResponse, TerminalServiceError> =>
      startSession(summary, plan, null).pipe(Effect.map(createResponse)),
    startCommand: (
      summary: TerminalSummary,
      { commandLines }: Pick<TerminalCommandRequest, "commandLines">,
      plans: TerminalCommandLaunchPlans,
    ): Effect.Effect<StartedCommandTerminal, TerminalServiceError> =>
      Effect.suspend(() => {
        const run: TerminalCommandRun = {
          phase: "command",
          stopRequested: false,
          result: Deferred.makeUnsafe(),
        };
        return startSession(summary, plans.shell, {
          lines: commandLines,
          plan: plans.command,
          run,
        }).pipe(
          Effect.map((session) => ({
            response: createResponse(session),
            result: Deferred.await(run.result),
          })),
        );
      }),
  };
};

const formatCommandEcho = (commandLines: TerminalCommandLines): Uint8Array =>
  new TextEncoder().encode(commandLines.map((line) => `\u001b[2m$ ${line}\u001b[22m\r\n`).join(""));
