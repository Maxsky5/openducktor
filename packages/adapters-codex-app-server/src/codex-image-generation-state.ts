import type { AgentImageGenerationPart } from "@openducktor/contracts";
import {
  mergeAgentImageGeneration,
  reduceAgentImageGenerationLifecycle,
  resolveAgentImageGenerationSettlement,
  type AgentImageGenerationLifecycle,
  settleAgentImageGeneration,
  type AgentImageGenerationSettlement,
} from "@openducktor/core";

export type CodexImageGenerationEnd = (
  | { scope: "turn"; turnId: string; reason: AgentImageGenerationSettlement }
  | { scope: "session"; reason: Exclude<AgentImageGenerationSettlement, "interrupted"> }
) & { timestamp?: string };
type ThreadImages = {
  items: Map<string, AgentImageGenerationPart>;
  lifecycle: AgentImageGenerationLifecycle;
  latestStartTimestamp?: string;
};
export class CodexImageGenerationState {
  private readonly runtimes = new Map<string, Map<string, ThreadImages>>();

  upsert(
    runtimeId: string,
    threadId: string,
    incoming: AgentImageGenerationPart,
    timestamp?: string,
  ): AgentImageGenerationPart {
    const state = this.thread(runtimeId, threadId);
    if (incoming.status === "running" && !state.items.has(itemKey(incoming)))
      recordStartTimestamp(state, timestamp);
    return this.update(state, incoming, "live");
  }

  /** Keep the state captured before the read so late history cannot revive a released session. */
  prepareHistory(
    runtimeId: string,
    threadId: string,
  ): (part: AgentImageGenerationPart, occurredAt?: string) => AgentImageGenerationPart {
    const owner = this.thread(runtimeId, threadId);
    const itemsAtReadStart = new Map(owner.items);
    return (part, occurredAt) => {
      const image = this.update(
        owner,
        part,
        "history",
        occurredAt,
        itemsAtReadStart.get(itemKey(part)),
      );
      return this.runtimes.get(runtimeId)?.get(threadId) === owner
        ? image
        : settleAgentImageGeneration(image, "runtime_failure");
    };
  }

  startTurn(runtimeId: string, threadId: string, turnId: string, timestamp?: string): void {
    const state = this.thread(runtimeId, threadId);
    if (!state.lifecycle.turnStarts?.has(turnId) && !state.lifecycle.turnEnds?.has(turnId))
      recordStartTimestamp(state, timestamp);
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
  ): AgentImageGenerationPart[] | null {
    const { reason } = end;
    const state = this.thread(runtimeId, threadId);
    // Native idle cutoffs cannot end newer turns. Explicit stop/release has no native timestamp.
    if (end.scope === "session" && end.timestamp !== undefined) {
      const cutoff = Date.parse(end.timestamp);
      if (
        (state.lifecycle.sessionEnd &&
          cutoff <= Date.parse(state.lifecycle.sessionEnd.timestamp)) ||
        (state.latestStartTimestamp && cutoff < Date.parse(state.latestStartTimestamp))
      )
        return null;
    }
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
    currentAtReadStart?: AgentImageGenerationPart,
  ): AgentImageGenerationPart {
    const key = itemKey(incoming);
    const current = state.items.get(key);
    const merged = current
      ? mergeAgentImageGeneration(current, incoming, source, currentAtReadStart)
      : incoming;
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

const recordStartTimestamp = (state: ThreadImages, timestamp?: string): void => {
  if (
    timestamp !== undefined &&
    (state.latestStartTimestamp === undefined ||
      Date.parse(timestamp) > Date.parse(state.latestStartTimestamp))
  )
    state.latestStartTimestamp = timestamp;
};

const itemKey = (part: AgentImageGenerationPart): string =>
  JSON.stringify([part.turnId ?? null, part.itemId]);
