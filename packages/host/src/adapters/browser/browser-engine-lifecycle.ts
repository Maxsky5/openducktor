/** One-time signals that both browser engines need for their pages, sessions, and prompts. */

/** A signal that ends once, with a reason. A listener that comes after the end runs at once. */
export type BrowserEndSignal<Reason> = {
  isEnded(): boolean;
  /** The reason of the end, or null while the signal runs. */
  reason(): Reason | null;
  /** Ends the signal and calls each listener once. A second end does nothing. */
  end(reason: Reason): void;
  onEnded(listener: (reason: Reason) => void): () => void;
};

export const createBrowserEndSignal = <Reason>(): BrowserEndSignal<Reason> => {
  let ended: { reason: Reason } | null = null;
  const listeners = new Set<(reason: Reason) => void>();
  return {
    isEnded: () => ended !== null,
    reason: () => ended?.reason ?? null,
    end(reason) {
      if (ended !== null) return;
      ended = { reason };
      for (const listener of Array.from(listeners)) listener(reason);
      listeners.clear();
    },
    onEnded(listener) {
      if (ended !== null) {
        listener(ended.reason);
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/** Takes the first answer only. A later answer does nothing. */
export const answerOnce = <Value>(answer: (value: Value) => void): ((value: Value) => void) => {
  let answered = false;
  return (value) => {
    if (answered) return;
    answered = true;
    answer(value);
  };
};

/**
 * One permission request of a page. The host answers it once, or it ends with the document that
 * asked: whichever comes first settles it, and the other does nothing. An ended request is a
 * denial for the page.
 */
export const createBrowserPermissionRequest = (handlers: {
  onRespond(granted: boolean): void;
  onEnd(): void;
}) => {
  const ended = createBrowserEndSignal<void>();
  let settled = false;
  return {
    respond: (granted: boolean): void => {
      if (settled) return;
      settled = true;
      handlers.onRespond(granted);
    },
    end: (): void => {
      if (settled) return;
      settled = true;
      handlers.onEnd();
      ended.end();
    },
    onEnded: (listener: () => void): (() => void) => ended.onEnded(listener),
  };
};
