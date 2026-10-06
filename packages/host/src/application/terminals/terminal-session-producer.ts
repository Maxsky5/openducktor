import { TERMINAL_PROTOCOL_VERSION, type TerminalSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  TerminalPtyError,
  type TerminalPtyLaunchPlan,
  type TerminalPtyPort,
} from "../../ports/terminal-pty-port";
import type { TerminalOutputSource } from "../../ports/terminal-output-source-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalServiceError } from "./terminal-service-error";
import {
  activateTerminalSession,
  createTerminalSession,
  forgetTerminalSession,
  isLiveTerminal,
  type InteractiveTerminalSession,
  type OutputTerminalSession,
  type TerminalSession,
} from "./terminal-session";
import { type createTerminalSessionLifecycle, terminalFailure } from "./terminal-session-lifecycle";
import type { TerminalTitleSettlementScheduler } from "./terminal-title-settler";
import { createTerminalTitleTracker } from "./terminal-title-tracker";
import { createSerialLane } from "../../effect/serial-gate";

export const createTerminalSessionProducer = ({
  sessions,
  ptyPort,
  lifecycle,
  scheduleTitleSettlement,
}: {
  sessions: Map<string, TerminalSession>;
  ptyPort: TerminalPtyPort;
  lifecycle: ReturnType<typeof createTerminalSessionLifecycle>;
  scheduleTitleSettlement: TerminalTitleSettlementScheduler | undefined;
}) => {
  const { applyStreamEvents, handleExit, handleFailure } = lifecycle;
  const publishTitle = (session: TerminalSession, title: string): void => {
    if (title === session.summary.label) return;
    session.summary.label = title;
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

  return {
    start: (
      summary: TerminalSummary,
      plan: TerminalPtyLaunchPlan,
    ): Effect.Effect<TerminalSummary, TerminalServiceError> =>
      Effect.gen(function* () {
        let session: InteractiveTerminalSession;
        const titleTracker = createTerminalTitleTracker(
          (title) => publishTitle(session, title),
          scheduleTitleSettlement,
        );
        session = createTerminalSession({
          kind: "interactive",
          summary,
          titleTracker,
          operations: createSerialLane(),
          replayByteLimit: TERMINAL_LIMITS.replayBytes,
          shell: plan.shell,
          grid: plan.grid,
        });
        sessions.set(summary.terminalId, session);
        const handleResult = yield* Effect.result(
          ptyPort.start(plan, {
            onOutput: (data) => acceptOutput(session, data),
            onFailure: (failure) => {
              applyStreamEvents(
                session,
                session.output.publishFailure({
                  code: failure.code === "operation_failed" ? "protocol_error" : failure.code,
                  message: `${failure.message} Close this tab and create a new terminal after resolving the error.`,
                  terminalId: summary.terminalId,
                  workingDir: plan.cwd,
                }),
              );
              handleFailure(session);
            },
            onExit: ({ exitCode, signal }) => handleExit(session, exitCode, signal),
          }),
        );
        if (handleResult._tag === "Failure") {
          forgetTerminalSession(session);
          sessions.delete(summary.terminalId);
          return yield* Effect.fail(
            terminalFailure(
              handleResult.failure.code === "unsupported_runtime"
                ? "unsupported_runtime"
                : "spawn_failed",
              "create",
              handleResult.failure.message,
              summary.terminalId,
              handleResult.failure,
            ),
          );
        }
        activateTerminalSession(session, handleResult.success);
        return { ...session.summary, context: { ...session.summary.context } };
      }),
    openOutputSource: (
      summary: TerminalSummary,
      onForgotten: () => void,
    ): Effect.Effect<TerminalOutputSource> =>
      Effect.sync(() => {
        let session: OutputTerminalSession;
        const titleTracker = createTerminalTitleTracker(
          (title) => publishTitle(session, title),
          scheduleTitleSettlement,
        );
        session = createTerminalSession({
          kind: "output",
          summary,
          titleTracker,
          operations: createSerialLane(),
          replayByteLimit: TERMINAL_LIMITS.replayBytes,
          grid: { columns: 80, rows: 24 },
        });
        sessions.set(summary.terminalId, session);
        session.onForgotten = onForgotten;
        return {
          terminalId: summary.terminalId,
          write: (data) => acceptOutput(session, data),
          activate: (handle) =>
            Effect.gen(function* () {
              const activated = activateTerminalSession(session, handle);
              if (!activated || session.output.isOverflowed) {
                return yield* new TerminalPtyError({
                  code: "operation_failed",
                  operation: "start",
                  message:
                    "Dev server output exceeded its limit or ended during startup. Reduce output and restart the server.",
                });
              }
              applyStreamEvents(session, yield* session.output.pauseIfRequested(handle));
            }),
          exit: ({ exitCode, signal }) => {
            if (sessions.get(summary.terminalId) === session) handleExit(session, exitCode, signal);
          },
          release: () => {
            if (sessions.get(summary.terminalId) !== session) return;
            applyStreamEvents(
              session,
              session.output.publish({
                version: TERMINAL_PROTOCOL_VERSION,
                type: "terminal_forgotten",
                terminalId: summary.terminalId,
              }),
            );
            forgetTerminalSession(session);
            sessions.delete(summary.terminalId);
          },
        };
      }),
  };
};
