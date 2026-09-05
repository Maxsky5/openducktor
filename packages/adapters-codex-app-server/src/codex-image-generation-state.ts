import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { mergeAgentImageGeneration } from "@openducktor/core";

export type CodexImageSettlement = "interrupted" | "turn_ended" | "runtime_failure";

export class CodexImageGenerationState {
  private readonly runtimes = new Map<string, Map<string, Map<string, AgentImageGenerationPart>>>();

  upsert(
    runtimeId: string,
    threadId: string,
    incoming: AgentImageGenerationPart,
  ): AgentImageGenerationPart {
    let threads = this.runtimes.get(runtimeId);
    if (!threads) {
      threads = new Map();
      this.runtimes.set(runtimeId, threads);
    }
    let items = threads.get(threadId);
    if (!items) {
      items = new Map();
      threads.set(threadId, items);
    }
    const current = items.get(incoming.itemId);
    const next = current ? mergeAgentImageGeneration(current, incoming, "live") : incoming;
    items.set(next.itemId, next);
    return next;
  }

  settle(
    runtimeId: string,
    threadId: string,
    turnId: string | undefined,
    reason: CodexImageSettlement,
  ): AgentImageGenerationPart[] {
    const items = this.runtimes.get(runtimeId)?.get(threadId);
    const settled: AgentImageGenerationPart[] = [];
    for (const item of items?.values() ?? []) {
      const unresolved =
        item.status === "running" || (item.status === "incomplete" && reason === "interrupted");
      if (!unresolved || (turnId !== undefined && item.turnId !== turnId)) continue;
      const { incompleteReason: _incompleteReason, ...metadata } = item;
      const next: AgentImageGenerationPart =
        reason === "interrupted"
          ? { ...metadata, status: "interrupted" }
          : { ...item, status: "incomplete", incompleteReason: reason };
      items?.set(item.itemId, next);
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
}
