import type { CodexAppServerStreamEvent } from "../../ports/codex-app-server-port";
import { HostInvariantError } from "../../effect/host-errors";

export const createCodexLiveSessionEventHub = (runtimeId: string) => {
  let listener: ((event: CodexAppServerStreamEvent) => void) | null = null;
  return {
    subscribe(
      subscribedRuntimeId: string,
      nextListener: (event: CodexAppServerStreamEvent) => void,
    ): () => void {
      if (subscribedRuntimeId !== runtimeId) {
        throw new HostInvariantError({
          invariant: "codex-live-session.event-hub.runtime-match",
          message: `Cannot subscribe Codex runtime '${subscribedRuntimeId}' through event hub '${runtimeId}'.`,
          details: { runtimeId, subscribedRuntimeId },
        });
      }
      if (listener) {
        throw new HostInvariantError({
          invariant: "codex-live-session.event-hub.single-subscriber",
          message: `Codex runtime '${runtimeId}' already has a live event subscriber.`,
          details: { runtimeId },
        });
      }
      listener = nextListener;
      return () => {
        if (listener === nextListener) {
          listener = null;
        }
      };
    },
    emit(event: CodexAppServerStreamEvent): void {
      if (event.runtimeId !== runtimeId) {
        throw new HostInvariantError({
          invariant: "codex-live-session.event-hub.runtime-match",
          message: `Codex event for runtime '${event.runtimeId}' cannot enter event hub '${runtimeId}'.`,
          details: { eventRuntimeId: event.runtimeId, runtimeId },
        });
      }
      if (!listener) {
        throw new HostInvariantError({
          invariant: "codex-live-session.event-hub.observer-ready",
          message: `Codex runtime '${runtimeId}' emitted an event before observation was prepared.`,
          details: { runtimeId },
        });
      }
      listener(event);
    },
  };
};
