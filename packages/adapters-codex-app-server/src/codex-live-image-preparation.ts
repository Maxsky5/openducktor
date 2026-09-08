import type { AgentImageGenerationPart } from "@openducktor/contracts";
import type { CodexImageGenerationPreparer } from "./codex-image-generation";
import type { CodexRuntimeNotification } from "./codex-runtime-event-schema";

/** Own worker cancellation without making the synchronous mapper pipeline asynchronous. */
export class CodexLiveImagePreparation {
  private readonly pending = new Map<
    AbortController,
    {
      runtimeId: string;
      threadId: string;
      ownerThreadId: string;
    }
  >();

  constructor(private readonly prepareImages?: CodexImageGenerationPreparer) {}

  async prepare(
    runtimeId: string,
    ownerThreadId: string,
    notification: CodexRuntimeNotification,
  ): Promise<AgentImageGenerationPart | null | undefined> {
    if (
      !this.prepareImages ||
      (notification.method !== "item/started" && notification.method !== "item/completed") ||
      notification.params.item.type !== "imageGeneration"
    )
      return undefined;
    const { item, turnId, threadId } = notification.params;
    const cancellation = new AbortController();
    this.pending.set(cancellation, { runtimeId, threadId, ownerThreadId });
    try {
      const parts = await this.prepareImages(
        [
          {
            item,
            context: { turnId, liveStart: notification.method === "item/started" },
          },
        ],
        cancellation.signal,
      );
      if (cancellation.signal.aborted) return null;
      const part = parts[0];
      if (parts.length !== 1 || !part || part.itemId !== item.id || part.turnId !== turnId)
        throw new Error(
          `Image '${item.id}' preparation returned the wrong item. Reopen the session.`,
        );
      return part;
    } catch (error) {
      if (cancellation.signal.aborted) return null;
      throw error;
    } finally {
      this.pending.delete(cancellation);
    }
  }

  cancel(runtimeId?: string, threadId?: string): void {
    for (const [cancellation, owner] of this.pending) {
      if (runtimeId !== undefined && runtimeId !== owner.runtimeId) continue;
      if (threadId !== undefined && threadId !== owner.threadId && threadId !== owner.ownerThreadId)
        continue;
      cancellation.abort(new Error("The image session was released. Reopen the session."));
    }
  }
}
