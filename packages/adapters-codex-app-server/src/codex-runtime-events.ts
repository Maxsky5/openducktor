import { z } from "zod";
import {
  codexRuntimeStreamFault,
  parseCodexRuntimeStreamEvent,
  type CodexRuntimeStreamEvent,
} from "./codex-runtime-event-schema";
import type { CodexLiveEventPump } from "./codex-app-server-shared";
import type { CodexAppServerAdapterOptions } from "./types";

export { type CodexRuntimeStreamEvent } from "./codex-runtime-event-schema";

export class CodexRuntimeEventSubscriptions {
  private readonly pumpsByRuntimeId = new Map<string, CodexLiveEventPump>();

  constructor(private readonly subscribeEvents: CodexAppServerAdapterOptions["subscribeEvents"]) {}

  ensure(runtimeId: string, onEvent: (event: CodexRuntimeStreamEvent) => void): Promise<void> {
    if (!this.subscribeEvents) {
      throw new Error(
        `Cannot observe Codex runtime '${runtimeId}' because live event subscription is unavailable.`,
      );
    }
    const existing = this.pumpsByRuntimeId.get(runtimeId);
    if (existing) {
      return existing.ready;
    }

    const pump: CodexLiveEventPump = {
      unsubscribe: null,
      ready: Promise.resolve(),
    };
    this.pumpsByRuntimeId.set(runtimeId, pump);
    let unsubscribe: (() => void) | Promise<() => void>;
    try {
      unsubscribe = this.subscribeEvents(runtimeId, (event) => {
        if (event.runtimeId !== runtimeId) {
          return;
        }
        const message = z.json().safeParse(event.message);
        try {
          const parsed = parseCodexRuntimeStreamEvent(z.json().parse(event));
          if (parsed.kind !== "ignored_notification") {
            onEvent(parsed);
          }
        } catch (cause) {
          onEvent(
            codexRuntimeStreamFault({
              cause,
              message: message.success ? message.data : undefined,
              receivedAt: event.receivedAt,
              runtimeId: event.runtimeId,
              sourceKind: event.kind,
            }),
          );
        }
      });
    } catch (error) {
      if (this.pumpsByRuntimeId.get(runtimeId) === pump) {
        this.pumpsByRuntimeId.delete(runtimeId);
      }
      throw error;
    }

    pump.ready = (async () => {
      try {
        const resolved = await unsubscribe;
        if (this.pumpsByRuntimeId.get(runtimeId) !== pump) {
          resolved();
          return;
        }
        pump.unsubscribe = resolved;
      } catch (error) {
        if (this.pumpsByRuntimeId.get(runtimeId) === pump) {
          this.pumpsByRuntimeId.delete(runtimeId);
        }
        throw error;
      }
    })();
    return pump.ready;
  }

  stop(runtimeId: string): void {
    const pump = this.pumpsByRuntimeId.get(runtimeId);
    if (!pump) {
      return;
    }
    this.pumpsByRuntimeId.delete(runtimeId);
    pump.unsubscribe?.();
  }
}

export const threadIdFromRuntimeStreamEvent = (event: CodexRuntimeStreamEvent): string | null => {
  if (event.kind === "fault") {
    return event.threadId;
  }
  if (event.kind === "notification") {
    return event.message.method === "skills/changed" ? null : event.message.params.threadId;
  }
  switch (event.message.method) {
    case "execCommandApproval":
    case "applyPatchApproval":
      return event.message.params.conversationId;
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
      return null;
    default:
      return event.message.params.threadId ?? null;
  }
};
