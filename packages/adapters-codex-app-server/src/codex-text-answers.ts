import type { CodexRuntimeStreamEvent } from "./codex-runtime-event-schema";

type PendingAnswer = {
  text: string | null;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

const answerKey = (runtimeId: string, threadId: string) => `${runtimeId}\u0000${threadId}`;

/**
 * The answers of text generation threads. These threads have no session, so their events end
 * here and never reach the session projection.
 */
export class CodexTextAnswers {
  private readonly pending = new Map<string, PendingAnswer>();

  /** Waits for the final agent message of the next turn of the thread. */
  wait(runtimeId: string, threadId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending.set(answerKey(runtimeId, threadId), { text: null, resolve, reject });
    });
  }

  forget(runtimeId: string, threadId: string): void {
    this.pending.delete(answerKey(runtimeId, threadId));
  }

  /** Takes the event of a text generation thread. Returns false for any other thread. */
  observe(event: CodexRuntimeStreamEvent, threadId: string): boolean {
    if (this.pending.size === 0) return false;
    const key = answerKey(event.runtimeId, threadId);
    const answer = this.pending.get(key);
    if (!answer) return false;
    if (event.kind !== "notification") {
      // The thread has no tools and no approvals, so a request or an unreadable event ends it.
      this.pending.delete(key);
      answer.reject(
        new Error(
          event.kind === "fault"
            ? `Codex sent an event that OpenDucktor cannot read: ${event.message}`
            : `Codex asked for ${event.message.method} during a text generation.`,
        ),
      );
      return true;
    }
    const notification = event.message;
    if (
      notification?.method === "item/completed" &&
      notification.params.item.type === "agentMessage" &&
      notification.params.item.phase !== "commentary"
    ) {
      answer.text = notification.params.item.text;
    } else if (notification?.method === "turn/completed") {
      this.pending.delete(key);
      const { turn } = notification.params;
      if (turn.status === "completed" && answer.text?.trim()) answer.resolve(answer.text);
      else
        answer.reject(
          new Error(
            `Codex did not generate the text: ${turn.error?.message ?? `the turn ended as ${turn.status}`}.`,
          ),
        );
    }
    return true;
  }

  /** Fails the waiting generations of a runtime that stops. */
  clearRuntime(runtimeId: string): void {
    for (const [key, answer] of this.pending) {
      if (!key.startsWith(`${runtimeId}\u0000`)) continue;
      this.pending.delete(key);
      answer.reject(new Error("The Codex runtime stopped before it generated the text."));
    }
  }
}
