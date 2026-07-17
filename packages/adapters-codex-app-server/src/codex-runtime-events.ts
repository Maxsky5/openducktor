import { extractThreadIdFromParams } from "./codex-app-server-requests";
import { type CodexLiveEventPump, isPlainObject } from "./codex-app-server-shared";
import type { CodexAppServerAdapterOptions } from "./types";

export type CodexRuntimeStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  receivedAt: string;
  message: unknown;
};

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
        onEvent(event);
      });
    } catch (error) {
      if (this.pumpsByRuntimeId.get(runtimeId) === pump) {
        this.pumpsByRuntimeId.delete(runtimeId);
      }
      throw error;
    }

    if (typeof (unsubscribe as Promise<() => void>).then === "function") {
      pump.ready = (async () => {
        try {
          const resolved = await (unsubscribe as Promise<() => void>);
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

    pump.unsubscribe = unsubscribe as () => void;
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

export const threadIdFromRuntimeStreamEvent = (
  event: Pick<CodexRuntimeStreamEvent, "message">,
): string | null => {
  if (!isPlainObject(event.message)) {
    return null;
  }
  return extractThreadIdFromParams(event.message.params);
};
