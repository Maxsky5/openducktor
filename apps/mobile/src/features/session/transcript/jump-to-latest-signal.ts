/**
 * Asks the transcript to show the latest message, such as after a send. A signal object, not a
 * counter in state, so a send does not render the session screen again.
 */
export type JumpToLatestSignal = {
  emit: () => void;
  subscribe: (listener: () => void) => () => void;
};

export const createJumpToLatestSignal = (): JumpToLatestSignal => {
  const listeners = new Set<() => void>();
  return {
    emit: () => {
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
