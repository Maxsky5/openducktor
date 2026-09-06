import type { AgentImageGenerationPart } from "@openducktor/contracts";
import {
  mergeAgentImageGeneration,
  settleAgentImageGeneration,
  type AgentImageGenerationSettlement,
} from "@openducktor/core";

export type CodexImageGenerationEnd =
  | { scope: "turn"; turnId: string; reason: AgentImageGenerationSettlement }
  | { scope: "session"; reason: Exclude<AgentImageGenerationSettlement, "interrupted"> };
type ThreadImages = {
  items: Map<string, AgentImageGenerationPart>;
  terminalTurns: Map<string, AgentImageGenerationSettlement>;
  startedTurns: Set<string>;
  sessionEnd?: { timestamp: string; reason: AgentImageGenerationSettlement };
};
const itemKey = (part: AgentImageGenerationPart): string =>
  JSON.stringify([part.turnId ?? null, part.itemId]);

export class CodexImageGenerationState {
  private readonly runtimes = new Map<string, Map<string, ThreadImages>>();

  upsert(
    runtimeId: string,
    threadId: string,
    incoming: AgentImageGenerationPart,
  ): AgentImageGenerationPart {
    return this.update(this.thread(runtimeId, threadId), incoming, "live");
  }

  /** Keep the state captured before the read so late history cannot revive a released session. */
  prepareHistory(
    runtimeId: string,
    threadId: string,
  ): (part: AgentImageGenerationPart, occurredAt?: string) => AgentImageGenerationPart {
    const owner = this.thread(runtimeId, threadId);
    return (part, occurredAt) => {
      const image = this.update(owner, part, "history", occurredAt);
      return this.runtimes.get(runtimeId)?.get(threadId) === owner
        ? image
        : settleAgentImageGeneration(image, "runtime_failure");
    };
  }

  startTurn(runtimeId: string, threadId: string, turnId: string): void {
    const state = this.thread(runtimeId, threadId);
    if (!state.terminalTurns.has(turnId)) state.startedTurns.add(turnId);
  }

  settle(
    runtimeId: string,
    threadId: string,
    end: CodexImageGenerationEnd,
    timestamp: string,
  ): AgentImageGenerationPart[] {
    const { reason } = end;
    const state = this.thread(runtimeId, threadId);
    const recordTurn = (id: string) => {
      if (state.terminalTurns.get(id) !== "interrupted") state.terminalTurns.set(id, reason);
    };
    if (end.scope === "turn") {
      recordTurn(end.turnId);
      state.startedTurns.delete(end.turnId);
    } else {
      state.sessionEnd = { timestamp, reason };
      for (const id of state.startedTurns) recordTurn(id);
      state.startedTurns.clear();
    }
    const settled: AgentImageGenerationPart[] = [];
    for (const item of state.items.values()) {
      if (end.scope === "turn" && item.turnId !== end.turnId) continue;
      if (item.turnId !== undefined) recordTurn(item.turnId);
      const next = settleAgentImageGeneration(item, reason);
      if (next === item) continue;
      state.items.set(itemKey(item), next);
      settled.push(next);
    }
    return settled;
  }

  clearSession(threadId: string, runtimeId?: string): void {
    for (const [id, threads] of this.runtimes) {
      if (runtimeId !== undefined && id !== runtimeId) continue;
      threads.delete(threadId);
      if (threads.size === 0) this.runtimes.delete(id);
    }
  }

  clearRuntime(runtimeId: string): void {
    this.runtimes.delete(runtimeId);
  }

  private thread(runtimeId: string, threadId: string): ThreadImages {
    let threads = this.runtimes.get(runtimeId);
    if (!threads) {
      threads = new Map();
      this.runtimes.set(runtimeId, threads);
    }
    let state = threads.get(threadId);
    if (!state) {
      state = { items: new Map(), terminalTurns: new Map(), startedTurns: new Set() };
      threads.set(threadId, state);
    }
    return state;
  }

  private update(
    state: ThreadImages,
    incoming: AgentImageGenerationPart,
    source: "live" | "history",
    occurredAt?: string,
  ): AgentImageGenerationPart {
    const key = itemKey(incoming);
    const current = state.items.get(key);
    const merged = current ? mergeAgentImageGeneration(current, incoming, source) : incoming;
    const turnEnd =
      merged.turnId === undefined ? undefined : state.terminalTurns.get(merged.turnId);
    const hasNewTurn = merged.turnId !== undefined && state.startedTurns.has(merged.turnId);
    const sessionEnd = state.sessionEnd;
    const historyEnd =
      source === "history" &&
      sessionEnd &&
      !hasNewTurn &&
      (occurredAt === undefined || Date.parse(occurredAt) <= Date.parse(sessionEnd.timestamp))
        ? sessionEnd.reason
        : undefined;
    const terminal = turnEnd ?? historyEnd;
    const next = terminal ? settleAgentImageGeneration(merged, terminal) : merged;
    state.items.set(key, next);
    return next;
  }
}
