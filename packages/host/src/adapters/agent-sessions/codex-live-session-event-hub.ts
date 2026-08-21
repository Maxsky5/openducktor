import type { CodexAppServerStreamEvent } from "../../ports/codex-app-server-port";

export const createCodexLiveSessionEventHub = (runtimeId: string) => {
  let listener: ((event: CodexAppServerStreamEvent) => void) | null = null;
  return {
    subscribe(
      subscribedRuntimeId: string,
      nextListener: (event: CodexAppServerStreamEvent) => void,
    ): () => void {
      if (subscribedRuntimeId !== runtimeId) {
        throw new Error(
          `Cannot subscribe Codex runtime '${subscribedRuntimeId}' through event hub '${runtimeId}'.`,
        );
      }
      if (listener) {
        throw new Error(`Codex runtime '${runtimeId}' already has a live event subscriber.`);
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
        throw new Error(
          `Codex event for runtime '${event.runtimeId}' cannot enter event hub '${runtimeId}'.`,
        );
      }
      if (!listener) {
        throw new Error(
          `Codex runtime '${runtimeId}' emitted an event before observation was prepared.`,
        );
      }
      listener(event);
    },
  };
};
