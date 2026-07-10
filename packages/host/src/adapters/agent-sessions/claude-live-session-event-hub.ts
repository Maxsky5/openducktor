import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";

export type ClaudeRuntimeEventListener = (
  session: ClaudeSessionContext,
  event: ClaudeAgentSdkEvent,
) => void;

export type ClaudeAgentSdkEventHub = {
  readonly emit: ClaudeRuntimeEventListener;
  readonly subscribe: (runtimeId: string, listener: ClaudeRuntimeEventListener) => () => void;
};

export const createClaudeAgentSdkEventHub = (): ClaudeAgentSdkEventHub => {
  const listeners = new Map<string, ClaudeRuntimeEventListener>();
  return {
    emit(session, event) {
      const listener = listeners.get(session.runtimeId);
      if (!listener) {
        throw new Error(
          `Claude runtime '${session.runtimeId}' emitted '${event.type}' without a live-session adapter.`,
        );
      }
      listener(session, event);
    },
    subscribe(runtimeId, listener) {
      if (listeners.has(runtimeId)) {
        throw new Error(`Claude runtime '${runtimeId}' already has a live event subscriber.`);
      }
      listeners.set(runtimeId, listener);
      return () => {
        if (listeners.get(runtimeId) === listener) {
          listeners.delete(runtimeId);
        }
      };
    },
  };
};
