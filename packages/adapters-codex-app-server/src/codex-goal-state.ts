import type { AgentSessionGoal, CodexAppServerThreadGoal } from "@openducktor/contracts";

/** The OpenDucktor goal of a native Codex goal. */
export const toAgentSessionGoal = (goal: CodexAppServerThreadGoal): AgentSessionGoal => ({
  objective: goal.objective,
  status:
    goal.status === "usageLimited" || goal.status === "budgetLimited"
      ? "limit_reached"
      : goal.status,
});

/**
 * The goal that Codex last reported for each thread, and the threads that wait for the goal turn
 * that Codex starts after a turn end.
 *
 * Codex reports the goal of a thread after each change and after each `thread/resume`, also before
 * OpenDucktor registers the resumed session. So the state keeps the goal of every thread of the
 * runtime, and a session that registers later reads its current goal.
 */
export class CodexGoalState {
  private readonly goalsByRuntimeId = new Map<string, Map<string, CodexAppServerThreadGoal>>();
  private readonly waitingByRuntimeId = new Map<string, Set<string>>();
  private readonly revisionsByRuntimeId = new Map<string, Map<string, number>>();
  /** Threads whose accepted set or resume has no goal update yet. */
  private readonly activatingByRuntimeId = new Map<string, Set<string>>();

  goal(runtimeId: string, threadId: string): AgentSessionGoal | undefined {
    const goal = this.goalsByRuntimeId.get(runtimeId)?.get(threadId);
    return goal ? toAgentSessionGoal(goal) : undefined;
  }

  /** Codex starts another goal turn after each turn end while the goal is active. */
  isActive(runtimeId: string, threadId: string): boolean {
    return this.goalsByRuntimeId.get(runtimeId)?.get(threadId)?.status === "active";
  }

  /** The goal is active, or an accepted set or resume waits for its goal update. */
  mayBeActive(runtimeId: string, threadId: string): boolean {
    return (
      this.isActive(runtimeId, threadId) ||
      this.activatingByRuntimeId.get(runtimeId)?.has(threadId) === true
    );
  }

  revision(runtimeId: string, threadId: string): number {
    return this.revisionsByRuntimeId.get(runtimeId)?.get(threadId) ?? 0;
  }

  /**
   * Records an accepted set or resume. When a goal update came after the request, that update is
   * the current state, so the result is whether the goal is active.
   */
  acceptActivation(runtimeId: string, threadId: string, revisionBefore: number): boolean {
    if (this.revision(runtimeId, threadId) !== revisionBefore) {
      return this.isActive(runtimeId, threadId);
    }
    let activating = this.activatingByRuntimeId.get(runtimeId);
    if (!activating) {
      activating = new Set();
      this.activatingByRuntimeId.set(runtimeId, activating);
    }
    activating.add(threadId);
    return true;
  }

  /** Applies a native goal update. `null` clears the goal. */
  apply(runtimeId: string, threadId: string, goal: CodexAppServerThreadGoal | null): void {
    let revisions = this.revisionsByRuntimeId.get(runtimeId);
    if (!revisions) {
      revisions = new Map();
      this.revisionsByRuntimeId.set(runtimeId, revisions);
    }
    revisions.set(threadId, this.revision(runtimeId, threadId) + 1);
    this.activatingByRuntimeId.get(runtimeId)?.delete(threadId);
    let goals = this.goalsByRuntimeId.get(runtimeId);
    if (goal === null) {
      goals?.delete(threadId);
      return;
    }
    if (!goals) {
      goals = new Map();
      this.goalsByRuntimeId.set(runtimeId, goals);
    }
    goals.set(threadId, goal);
  }

  /** The thread has no running turn, and Codex starts the next goal turn by itself. */
  isWaitingForGoalTurn(runtimeId: string, threadId: string): boolean {
    return this.waitingByRuntimeId.get(runtimeId)?.has(threadId) === true;
  }

  waitForGoalTurn(runtimeId: string, threadId: string): void {
    let waiting = this.waitingByRuntimeId.get(runtimeId);
    if (!waiting) {
      waiting = new Set();
      this.waitingByRuntimeId.set(runtimeId, waiting);
    }
    waiting.add(threadId);
  }

  /** Returns true when the thread waited for a goal turn. */
  stopWaiting(runtimeId: string, threadId: string): boolean {
    return this.waitingByRuntimeId.get(runtimeId)?.delete(threadId) === true;
  }

  clearRuntime(runtimeId: string): void {
    this.goalsByRuntimeId.delete(runtimeId);
    this.waitingByRuntimeId.delete(runtimeId);
    this.revisionsByRuntimeId.delete(runtimeId);
    this.activatingByRuntimeId.delete(runtimeId);
  }
}
