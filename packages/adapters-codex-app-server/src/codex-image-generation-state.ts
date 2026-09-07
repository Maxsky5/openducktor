import type { AgentImageGenerationPart } from "@openducktor/contracts";
import {
  mergeAgentImageGeneration,
  reduceAgentImageGenerationLifecycle,
  resolveAgentImageGenerationSettlement,
  type AgentImageGenerationLifecycle,
  settleAgentImageGeneration,
  type AgentImageGenerationSettlement,
} from "@openducktor/core";

export type CodexImageGenerationEnd =
  | { scope: "turn"; turnId: string; reason: AgentImageGenerationSettlement }
  | { scope: "session"; reason: Exclude<AgentImageGenerationSettlement, "interrupted"> };
type ThreadImages = {
  items: Map<string, AgentImageGenerationPart>;
  lifecycle: AgentImageGenerationLifecycle;
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
    state.lifecycle = reduceAgentImageGenerationLifecycle(state.lifecycle, {
      type: "turn_started",
      turnId,
    });
  }

  settle(
    runtimeId: string,
    threadId: string,
    end: CodexImageGenerationEnd,
    timestamp: string,
  ): AgentImageGenerationPart[] {
    const { reason } = end;
    const state = this.thread(runtimeId, threadId);
    state.lifecycle = reduceAgentImageGenerationLifecycle(
      state.lifecycle,
      end.scope === "turn"
        ? { type: "turn_ended", turnId: end.turnId, reason }
        : {
            type: "session_ended",
            timestamp,
            reason,
            turnIds: [...state.items.values()].flatMap((item) =>
              item.turnId === undefined ? [] : [item.turnId],
            ),
          },
    );
    const settled: AgentImageGenerationPart[] = [];
    for (const item of state.items.values()) {
      if (end.scope === "turn" && item.turnId !== end.turnId) continue;
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
      state = { items: new Map(), lifecycle: {} };
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
    const terminal = resolveAgentImageGenerationSettlement(
      state.lifecycle,
      { turnId: merged.turnId, timestamp: occurredAt },
      source === "live" ? "turn" : "session",
    );
    const next = terminal ? settleAgentImageGeneration(merged, terminal) : merged;
    state.items.set(key, next);
    return next;
  }
}
