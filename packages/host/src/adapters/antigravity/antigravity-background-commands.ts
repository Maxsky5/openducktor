import type { SessionUpdate, ToolCallStatus } from "@agentclientprotocol/sdk/unstable";
import type { AgentSessionBackgroundTask } from "@openducktor/contracts";
import { readAntigravityBackgroundCommand } from "./antigravity-native-payloads";

const STOP_ONE: AgentSessionBackgroundTask["stop"] = {
  allowed: false,
  reason: "Antigravity cannot stop one background command. Stop the session to stop all of them.",
};

const isRunning = (status: ToolCallStatus | null | undefined): boolean =>
  status === "pending" || status === "in_progress";

/**
 * The `run_command` calls of one session. A command that still runs when its turn ends runs in
 * the background, and the session stays busy until Antigravity reports its end. A daemon, such as
 * a dev server, does not count, because Antigravity does not wait for it either. Antigravity
 * reports a command only through its tool call updates, and it has no call that stops one command.
 */
export class AntigravityBackgroundCommands {
  /** The command line of each call that still runs. */
  private readonly running = new Map<string, string>();
  /** The calls that outlived their turn, oldest first. */
  private readonly background = new Map<string, AgentSessionBackgroundTask>();
  private endWaiters: Array<() => void> = [];

  get active(): boolean {
    return this.background.size > 0;
  }

  get tasks(): AgentSessionBackgroundTask[] {
    return [...this.background.values()];
  }

  /** Applies a live update. Returns true when a background command ended. */
  apply(update: SessionUpdate): boolean {
    if (update.sessionUpdate === "tool_call") {
      const command = readAntigravityBackgroundCommand(update);
      if (command && isRunning(update.status)) this.running.set(update.toolCallId, command);
      return false;
    }
    if (update.sessionUpdate !== "tool_call_update") return false;
    if (update.status !== "completed" && update.status !== "failed") return false;
    this.running.delete(update.toolCallId);
    if (!this.background.delete(update.toolCallId)) return false;
    if (!this.active) this.settleWaiters();
    return true;
  }

  /**
   * Moves the commands that still run at the end of a turn to the background, and returns true
   * when background commands remain. Stop cancels the commands of the turn, so a stopped turn
   * moves none.
   */
  holdAfterTurn(stopped: boolean): boolean {
    for (const [toolCallId, title] of stopped ? [] : this.running) {
      if (this.background.has(toolCallId)) continue;
      this.background.set(toolCallId, {
        taskId: toolCallId,
        kind: "command",
        title,
        stop: STOP_ONE,
      });
    }
    return this.active;
  }

  /** Waits until no background command runs. Fails after the deadline. */
  async waitForEnd(deadlineMs: number): Promise<void> {
    if (!this.active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended = new Promise<"ended">((resolve) => this.endWaiters.push(() => resolve("ended")));
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), deadlineMs);
    });
    try {
      if ((await Promise.race([ended, timedOut])) === "timeout") {
        throw new Error(
          `Antigravity did not stop the background commands within ${deadlineMs / 1000} seconds. They keep running. Try Stop again.`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Forgets every command of a session that leaves the runtime. */
  clear(): void {
    this.running.clear();
    this.background.clear();
    this.settleWaiters();
  }

  private settleWaiters(): void {
    const waiters = this.endWaiters;
    this.endWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
