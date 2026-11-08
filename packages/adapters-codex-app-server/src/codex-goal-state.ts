import type { AgentSessionGoal, CodexAppServerThreadGoal } from "@openducktor/contracts";

/** The OpenDucktor goal of a native Codex goal. */
const toAgentSessionGoal = (goal: CodexAppServerThreadGoal): AgentSessionGoal => ({
  objective: goal.objective,
  status:
    goal.status === "usageLimited" || goal.status === "budgetLimited"
      ? "limit_reached"
      : goal.status,
});

type ThreadGoalState = {
  goal: CodexAppServerThreadGoal | null;
  /** The count of goal updates, so a request can tell if an update came after it. */
  revision: number;
  /** An accepted set or resume waits for its goal update. */
  activating: boolean;
  /** The thread has no running turn, and Codex starts the next goal turn by itself. */
  waiting: boolean;
};

/**
 * The goal that Codex last reported for each thread, and the threads that wait for the goal turn
 * that Codex starts after a turn end.
 *
 * Codex reports the goal of a thread after each change and after each `thread/resume`, also before
 * OpenDucktor registers the resumed session. So the state keeps the goal of every thread of the
 * runtime until its session is released, and a session that registers later reads its goal.
 */
export class CodexGoalState {
  private readonly threadsByRuntimeId = new Map<string, Map<string, ThreadGoalState>>();

  private peek(runtimeId: string, threadId: string): ThreadGoalState | undefined {
    return this.threadsByRuntimeId.get(runtimeId)?.get(threadId);
  }

  private thread(runtimeId: string, threadId: string): ThreadGoalState {
    let threads = this.threadsByRuntimeId.get(runtimeId);
    if (!threads) {
      threads = new Map();
      this.threadsByRuntimeId.set(runtimeId, threads);
    }
    let state = threads.get(threadId);
    if (!state) {
      state = { goal: null, revision: 0, activating: false, waiting: false };
      threads.set(threadId, state);
    }
    return state;
  }

  goal(runtimeId: string, threadId: string): AgentSessionGoal | undefined {
    const goal = this.peek(runtimeId, threadId)?.goal;
    return goal ? toAgentSessionGoal(goal) : undefined;
  }

  /** Codex starts another goal turn after each turn end while the goal is active. */
  isActive(runtimeId: string, threadId: string): boolean {
    return this.peek(runtimeId, threadId)?.goal?.status === "active";
  }

  /** The goal is active, or an accepted set or resume waits for its goal update. */
  mayBeActive(runtimeId: string, threadId: string): boolean {
    return (
      this.isActive(runtimeId, threadId) || this.peek(runtimeId, threadId)?.activating === true
    );
  }

  revision(runtimeId: string, threadId: string): number {
    return this.peek(runtimeId, threadId)?.revision ?? 0;
  }

  /**
   * Records an accepted set or resume. When a goal update came after the request, that update is
   * the current state, so the result is whether the goal is active.
   */
  acceptActivation(runtimeId: string, threadId: string, revisionBefore: number): boolean {
    const state = this.thread(runtimeId, threadId);
    if (state.revision !== revisionBefore) return state.goal?.status === "active";
    state.activating = true;
    return true;
  }

  /** Applies a native goal update. `null` clears the goal. */
  apply(runtimeId: string, threadId: string, goal: CodexAppServerThreadGoal | null): void {
    const state = this.thread(runtimeId, threadId);
    state.goal = goal;
    state.revision += 1;
    state.activating = false;
  }

  isWaitingForGoalTurn(runtimeId: string, threadId: string): boolean {
    return this.peek(runtimeId, threadId)?.waiting === true;
  }

  waitForGoalTurn(runtimeId: string, threadId: string): void {
    this.thread(runtimeId, threadId).waiting = true;
  }

  /** Returns true when the thread waited for a goal turn. */
  stopWaiting(runtimeId: string, threadId: string): boolean {
    const state = this.peek(runtimeId, threadId);
    if (!state?.waiting) return false;
    state.waiting = false;
    return true;
  }

  /** Forgets a released session. A later resume makes Codex report its goal again. */
  forgetThread(runtimeId: string, threadId: string): void {
    this.threadsByRuntimeId.get(runtimeId)?.delete(threadId);
  }

  clearRuntime(runtimeId: string): void {
    this.threadsByRuntimeId.delete(runtimeId);
  }
}
