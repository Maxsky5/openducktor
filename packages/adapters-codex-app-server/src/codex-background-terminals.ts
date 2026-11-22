import { type AgentSessionBackgroundTask, CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type BackgroundWaiter,
  BackgroundWorkLedger,
  compareRuntimeVersion,
} from "@openducktor/core";
import type { CodexTimedThreadItem } from "./codex-event-mapper";

/** Codex adds `thread/backgroundTerminals/terminate` in this version. */
const CODEX_BACKGROUND_TERMINAL_STOP_MINIMUM_VERSION = "0.140.0";

/**
 * Tells if Codex can stop one background terminal. `runtimeVersion` is the version that the host
 * read from the Codex executable, or `null` when the host could not read it.
 */
export const codexBackgroundTerminalStop = (
  runtimeVersion: string | null,
): AgentSessionBackgroundTask["stop"] => {
  const { label } = CODEX_RUNTIME_DESCRIPTOR;
  const minimum = CODEX_BACKGROUND_TERMINAL_STOP_MINIMUM_VERSION;
  const comparison = compareRuntimeVersion(runtimeVersion, minimum);
  if (comparison === null) {
    return {
      allowed: false,
      reason: `OpenDucktor cannot read the ${label} version. Stopping a background terminal needs ${label} ${minimum} or later.`,
    };
  }
  if (!comparison.supported) {
    return {
      allowed: false,
      reason: `${label} ${comparison.version} cannot stop a background terminal. Update ${label} to ${minimum} or later.`,
    };
  }
  return { allowed: true };
};

/**
 * How long Stop session waits for Codex to confirm the end of the commands that `clean` stopped.
 * Codex kills each process at once, waits at most `TRAILING_OUTPUT_GRACE` (100 ms) for its last
 * output, and then sends the late `item/completed` (`codex-rs/core/src/unified_exec/
 * process_manager.rs` and `async_watcher.rs`). So this limit only ends a wait for a confirmation
 * that does not come.
 */
export const CODEX_COMMAND_END_CONFIRMATION_LIMIT_MS = 10_000;

/** The task ID of a background terminal, unique in its session tree. */
export const codexBackgroundTaskId = (terminal: Pick<CodexRunningCommand, "threadId" | "itemId">) =>
  `${terminal.threadId}:${terminal.itemId}`;

type CodexCommandItem = Extract<CodexTimedThreadItem, { type: "commandExecution" }>;

/** A Codex command that still runs. */
export type CodexRunningCommand = {
  readonly threadId: string;
  readonly itemId: string;
  /**
   * The process ID from the start event, or null. A command that waited for an approval or an
   * auto-review starts with no process ID, and Codex sends no later start with it
   * (`codex-rs/app-server/src/bespoke_event_handling.rs`, `ItemStarted`).
   */
  readonly processId: string | null;
  readonly command: string;
};

/** A running command that the adapter follows. */
export type CodexTrackedCommand = CodexRunningCommand & {
  readonly key: string;
  readonly sessionID: string;
  readonly turnId: string;
  /** True once the turn of the command ended while the command still ran. */
  background: boolean;
};

const commandKey = (threadId: string, itemId: string): string => `${threadId}\u0000${itemId}`;

/** A wait for the end of commands that Codex was asked to stop. */
type CommandEndWait = {
  /**
   * Each command whose end Codex did not report yet, by command key. A wait that fails keeps its
   * commands, so only a confirmed end empties it.
   */
  readonly pending: Map<string, CodexTrackedCommand>;
  readonly settle: BackgroundWaiter;
  /** Ends the wait for the end of each command. */
  readonly unwatch: (() => void)[];
};

/** Follows the end of commands from before the request that stops them. */
export type CodexCommandEndWatch = {
  /**
   * Resolves when Codex reported the end of each command. Rejects when the adapter lost the
   * events of a command, or when Codex sends no end within `CODEX_COMMAND_END_CONFIRMATION_LIMIT_MS`.
   */
  readonly confirmed: () => Promise<void>;
  /** Stops following the commands, because the request that stops them failed. */
  readonly cancel: () => void;
};

const UNCONFIRMED_COMMANDS_ADVICE =
  "The commands may still run, so the session keeps them. Check their processes, then retry Stop or restart the runtime.";

/** The quoted commands, for an error message. */
export const codexCommandList = (
  commands: Iterable<Pick<CodexRunningCommand, "command">>,
): string => [...commands].map(({ command }) => `'${command}'`).join(", ");

/**
 * The background terminals of the threads of one runtime, from live notifications only. Codex has
 * no live marker for a background terminal. A command with a process ID that still runs when its
 * thread ends its turn is one, until Codex reports the command end in a late `item/completed`.
 * The release of a thread that still runs commands loses them for its nearest observed ancestor.
 */
export class CodexBackgroundTerminals extends BackgroundWorkLedger<CodexTrackedCommand> {
  /** Threads whose reply ended while background terminals of their tree still ran. */
  private readonly heldThreadIds = new Set<string>();
  /** The latest turn that started on each thread. */
  private readonly currentTurnIdByThreadId = new Map<string, string>();
  private readonly commandEndWaits = new Set<CommandEndWait>();

  observeStarted(threadId: string, turnId: string, item: CodexTimedThreadItem): void {
    if (!isRunningCommand(item)) return;
    const key = commandKey(threadId, item.id);
    if (this.get(key)) return;
    this.start({
      key,
      sessionID: threadId,
      threadId,
      itemId: item.id,
      processId: item.processId,
      command: item.command,
      turnId,
      background: false,
    });
  }

  /** Forgets an ended command. Returns true when it was a background terminal. */
  observeCompleted(threadId: string, itemId: string): boolean {
    return this.end(commandKey(threadId, itemId))?.background ?? false;
  }

  /**
   * A turn started on the thread. Returns true when the thread was held, because its new reply
   * runs in front of the terminals.
   */
  startTurn(threadId: string, turnId: string): boolean {
    this.currentTurnIdByThreadId.set(threadId, turnId);
    return this.heldThreadIds.delete(threadId);
  }

  /** Tells if a newer turn than `turnId` started on the thread. */
  isSupersededTurn(threadId: string, turnId: string): boolean {
    const currentTurnId = this.currentTurnIdByThreadId.get(threadId);
    return currentTurnId !== undefined && currentTurnId !== turnId;
  }

  /**
   * Follows the end of the commands. Call it in the same synchronous step that reads the commands,
   * and before the request that stops them, so that a loss of their events or of their thread
   * also fails the watch.
   */
  watchCommandEnds(commands: readonly CodexTrackedCommand[]): CodexCommandEndWatch {
    // The Promise executor runs at once, so it sets `settle`.
    let settle!: BackgroundWaiter;
    const promise = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // The watch can fail during the stop request, before Stop session reads it.
    promise.catch(() => undefined);
    const wait: CommandEndWait = {
      pending: new Map(commands.map((command) => [command.key, command])),
      settle,
      unwatch: [],
    };
    this.commandEndWaits.add(wait);
    // A command that already ended resolves its wait at once.
    for (const command of commands)
      wait.unwatch.push(
        this.watchEnd(command, {
          resolve: () => {
            wait.pending.delete(command.key);
            if (wait.pending.size === 0 && this.commandEndWaits.delete(wait)) settle.resolve();
          },
          reject: () => this.failCommandEndWait(wait, stoppedFollowing),
        }),
      );
    if (wait.pending.size === 0 && this.commandEndWaits.delete(wait)) settle.resolve();
    return {
      confirmed: () => {
        if (!this.commandEndWaits.has(wait)) return promise;
        const limit = setTimeout(
          () =>
            this.failCommandEndWait(
              wait,
              (list) =>
                `Codex did not confirm within ${CODEX_COMMAND_END_CONFIRMATION_LIMIT_MS / 1000} seconds that these background commands ended: ${list}. ${UNCONFIRMED_COMMANDS_ADVICE}`,
            ),
          CODEX_COMMAND_END_CONFIRMATION_LIMIT_MS,
        );
        return promise.finally(() => clearTimeout(limit));
      },
      cancel: () => this.endCommandEndWait(wait),
    };
  }

  /**
   * The adapter could not apply a live event of the thread, or of an unknown thread when
   * `threadId` is null. The event can be the end of a command, so each wait for a command of that
   * thread fails. The thread keeps its commands and no tracking loss.
   */
  loseThreadEvents(threadId: string | null, reason: string): void {
    for (const wait of this.commandEndWaits)
      if (
        threadId === null ||
        [...wait.pending.values()].some((command) => command.threadId === threadId)
      )
        this.failCommandEndWait(
          wait,
          (list) =>
            `OpenDucktor could not read a Codex event (${reason}), so it cannot confirm that these background commands ended: ${list}. ${UNCONFIRMED_COMMANDS_ADVICE}`,
        );
  }

  /**
   * A turn of the thread ended, or the thread runs no turn when `turnId` is not set. Each command
   * of that turn that still runs is a background terminal. Returns true when a command became one.
   */
  markTurnEnded(threadId: string, turnId?: string): boolean {
    let changed = false;
    for (const command of this.tasksOf(threadId)) {
      if (command.background || (turnId !== undefined && command.turnId !== turnId)) continue;
      command.background = true;
      changed = true;
    }
    return changed;
  }

  /** The background terminals of the tree of the thread, oldest first. */
  backgroundTerminals(threadId: string): CodexTrackedCommand[] {
    // Most commands end in their turn, so a snapshot skips the walk of the thread tree.
    if (!this.someTask(isBackground)) return [];
    return this.tasksIn(threadId).filter(isBackground);
  }

  /** Tells if a background terminal of the tree of the thread runs. */
  hasBackgroundTerminals(threadId: string): boolean {
    return this.someTask(isBackground) && this.tasksIn(threadId).some(isBackground);
  }

  hold(threadId: string): void {
    this.heldThreadIds.add(threadId);
  }

  /** Returns true when the thread was held. */
  unhold(threadId: string): boolean {
    return this.heldThreadIds.delete(threadId);
  }

  isHeld(threadId: string): boolean {
    return this.heldThreadIds.has(threadId);
  }

  /**
   * Stops following the released threads. Each wait for one of their commands fails. When they
   * leave running commands or a tracking loss, `ancestorId`, the nearest ancestor that stays
   * observed, takes the loss of its tree. Returns true when the ancestor lost the tracking.
   */
  releaseThreads(threadIds: readonly string[], ancestorId: string | undefined): boolean {
    const lost = this.release(threadIds, ancestorId, {
      dropped: (threadId) =>
        new Error(`OpenDucktor stopped following the Codex session '${threadId}'.`),
      unresolved: (commands) => codexDroppedCommandsError(threadIds[0]!, commands),
    });
    return lost !== undefined;
  }

  override removeSession(threadId: string, cause: Error): boolean {
    this.heldThreadIds.delete(threadId);
    this.currentTurnIdByThreadId.delete(threadId);
    return super.removeSession(threadId, cause);
  }

  private failCommandEndWait(wait: CommandEndWait, message: (commands: string) => string): void {
    if (!this.endCommandEndWait(wait)) return;
    wait.settle.reject(new Error(message(codexCommandList(wait.pending.values()))));
  }

  private endCommandEndWait(wait: CommandEndWait): boolean {
    for (const unwatch of wait.unwatch) unwatch();
    return this.commandEndWaits.delete(wait);
  }
}

const stoppedFollowing = (commands: string): string =>
  `OpenDucktor stopped following the Codex session before Codex confirmed that these background commands ended: ${commands}. The commands may still run. Check their processes.`;

/**
 * A descendant thread was released while it still ran commands, so its ancestors cannot confirm
 * that those commands ended.
 */
const codexDroppedCommandsError = (
  threadId: string,
  commands: readonly CodexRunningCommand[],
): Error =>
  new Error(
    `OpenDucktor stopped following the Codex session '${threadId}' before Codex confirmed that these background commands ended: ${codexCommandList(commands)}. The commands may still run, so the status of the parent sessions is unavailable. Check their processes, then restart the runtime.`,
  );

/** The session was released while Stop session still had to confirm that its commands ended. */
export const codexStopSessionReleasedError = (commands: readonly CodexRunningCommand[]): Error =>
  new Error(
    commands.length === 0
      ? "OpenDucktor stopped following the Codex session before it could confirm that the session runs no background command. Commands may still run. Check their processes."
      : stoppedFollowing(codexCommandList(commands)),
  );

const isBackground = (command: CodexTrackedCommand): boolean => command.background;

const isRunningCommand = (item: CodexTimedThreadItem): item is CodexCommandItem =>
  item.type === "commandExecution" && item.status === "inProgress";
