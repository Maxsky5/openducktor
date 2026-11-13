import { RUNNING_TOOL_UPDATE_INTERVAL_MS } from "@openducktor/contracts";
import type { CodexTimedThreadItem } from "./codex-event-mapper";
import type { CodexNotificationRecord } from "./types";

/**
 * The shortest time between two updates of the output of one running command. A client shows a
 * running tool update at most this often, so a shorter time only sends updates that it replaces.
 */
export const LIVE_COMMAND_OUTPUT_INTERVAL_MS = RUNNING_TOOL_UPDATE_INTERVAL_MS;
/**
 * The running output keeps its last characters, about 200 lines: more than a reader sees at once.
 * Each update sends all of them, so a longer tail sends more bytes each time. The completed
 * command gives all of its output.
 */
export const LIVE_COMMAND_OUTPUT_TAIL_LENGTH = 16 * 1024;
export const LIVE_COMMAND_OUTPUT_CUT_NOTICE = "[Earlier output is shown when the command ends.]\n";

/** The clock that the buffer uses, so a test can run it by hand. `schedule` returns a cancel. */
export type LiveCommandOutputTimers = {
  now: () => number;
  schedule: (run: () => void, delayMs: number) => () => void;
};

/**
 * Runs a delayed update of a runtime after the runtime events that came before it. The adapter
 * sends the events of each runtime event to the host in one update, so an update that a timer
 * starts goes through the same queue to reach the host.
 */
export type QueueLiveCommandUpdate = (runtimeId: string, update: () => void) => void;

const REAL_TIMERS: LiveCommandOutputTimers = {
  now: () => Date.now(),
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
};

/** The runtime and the thread of a Codex session. */
type LiveCommandSession = { runtimeId: string; threadId: string };

const commandKey = (session: LiveCommandSession, itemId: string): string =>
  JSON.stringify([session.runtimeId, session.threadId, itemId]);

type RunningCommand = {
  runtimeId: string;
  threadId: string;
  /** Shows the running output, as an update of the started command. */
  emit: (output: string) => void;
  output: string;
  cut: boolean;
  lastEmittedAt: number;
  /** True while an update waits for the end of the interval or for its place in the queue. */
  updatePending: boolean;
  /** Cancels the timer of the waiting update. */
  cancelTimer: (() => void) | null;
};

/**
 * The output of running Codex commands. Codex sends the output in small chunks, many times a
 * second, so the buffer shows it at most once each `LIVE_COMMAND_OUTPUT_INTERVAL_MS`, and the
 * last chunk shows when the interval ends. It shows only the end of a long output, so each update
 * stays small. The completed command replaces it with all of its output.
 *
 * Codex starts to send chunks after the command starts, so the running output can miss the first
 * lines. The completed command has them.
 */
export class CodexLiveCommandOutputs {
  private readonly running = new Map<string, RunningCommand>();

  constructor(
    private readonly queueUpdate: QueueLiveCommandUpdate,
    private readonly timers: LiveCommandOutputTimers = REAL_TIMERS,
  ) {}

  /**
   * Follows the commands of a session through its notifications. A started command shows its
   * running output with `showRunning`, as an update of its started item. A command ends with its
   * item. The commands of a session also end with its turn: a command can run on after its turn,
   * and a running command update would show the session as working again.
   */
  follow(
    session: LiveCommandSession,
    notification: CodexNotificationRecord,
    showRunning: (item: CodexTimedThreadItem, turnId: string) => void,
  ): void {
    switch (notification.method) {
      case "item/started": {
        const { item, startedAtMs, turnId } = notification.params;
        if (item.type !== "commandExecution") return;
        this.start(session, item.id, (output) =>
          showRunning({ ...item, startedAtMs, aggregatedOutput: output }, turnId),
        );
        return;
      }
      case "item/completed":
        this.finish(session, notification.params.item.id);
        return;
      case "turn/completed":
        this.finishAll(session.runtimeId, session.threadId);
    }
  }

  start(session: LiveCommandSession, itemId: string, emit: (output: string) => void): void {
    this.finish(session, itemId);
    this.running.set(commandKey(session, itemId), {
      runtimeId: session.runtimeId,
      threadId: session.threadId,
      emit,
      output: "",
      cut: false,
      lastEmittedAt: Number.NEGATIVE_INFINITY,
      updatePending: false,
      cancelTimer: null,
    });
  }

  /**
   * Adds a chunk of output, in the runtime event that brought it. The adapter gives each chunk
   * here before its event mappers. A command that did not start here, such as one before a
   * restart, has none.
   */
  append(session: LiveCommandSession, itemId: string, delta: string): void {
    const key = commandKey(session, itemId);
    const command = this.running.get(key);
    if (!command || delta.length === 0) return;
    command.output += delta;
    if (command.output.length > 2 * LIVE_COMMAND_OUTPUT_TAIL_LENGTH) {
      command.output = command.output.slice(-LIVE_COMMAND_OUTPUT_TAIL_LENGTH);
      command.cut = true;
    }
    if (command.updatePending) return;
    const wait = command.lastEmittedAt + LIVE_COMMAND_OUTPUT_INTERVAL_MS - this.timers.now();
    if (wait <= 0) {
      this.emit(command);
      return;
    }
    command.updatePending = true;
    command.cancelTimer = this.timers.schedule(() => {
      command.cancelTimer = null;
      this.queueUpdate(command.runtimeId, () => {
        // The command can end, or start again, while its update waits in the queue.
        if (this.running.get(key) !== command) return;
        command.updatePending = false;
        this.emit(command);
      });
    }, wait);
  }

  /** Forgets a command that ended, so no late update shows it as running again. */
  finish(session: LiveCommandSession, itemId: string): void {
    this.forget(commandKey(session, itemId));
  }

  /** Forgets the running commands of a session or a runtime that the adapter no longer follows. */
  finishAll(runtimeId: string, threadId?: string): void {
    for (const [key, command] of this.running) {
      if (
        command.runtimeId === runtimeId &&
        (threadId === undefined || command.threadId === threadId)
      )
        this.forget(key);
    }
  }

  private forget(key: string): void {
    const command = this.running.get(key);
    if (!command) return;
    command.cancelTimer?.();
    this.running.delete(key);
  }

  private emit(command: RunningCommand): void {
    command.lastEmittedAt = this.timers.now();
    const shown =
      command.cut || command.output.length > LIVE_COMMAND_OUTPUT_TAIL_LENGTH
        ? `${LIVE_COMMAND_OUTPUT_CUT_NOTICE}${command.output.slice(-LIVE_COMMAND_OUTPUT_TAIL_LENGTH)}`
        : command.output;
    command.emit(shown);
  }
}
