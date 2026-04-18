export type ComposerAutofocusState = {
  lastDisplayedSessionId: string | null;
  pendingAutofocusSessionId: string | null;
  waitAnchor: Element | null;
};

export type ComposerAutofocusSnapshot = {
  displayedSessionId: string | null;
  isComposerInteractive: boolean;
  activeElement: Element | null;
  focusInsideComposer: boolean;
};

export type ComposerAutofocusResult = {
  nextState: ComposerAutofocusState;
  shouldFocus: boolean;
};

export const createComposerAutofocusState = (): ComposerAutofocusState => ({
  lastDisplayedSessionId: null,
  pendingAutofocusSessionId: null,
  waitAnchor: null,
});

const clearComposerAutofocusState = (): ComposerAutofocusState => createComposerAutofocusState();

const completeComposerAutofocusState = (state: ComposerAutofocusState): ComposerAutofocusState => ({
  ...state,
  pendingAutofocusSessionId: null,
  waitAnchor: null,
});

const didFocusStayOnWaitAnchor = (
  waitAnchor: Element | null,
  activeElement: Element | null,
): boolean => {
  if (!waitAnchor || !activeElement) {
    // Treat an unknown anchor as "focus didn't move" so delayed readiness can still autofocus.
    return true;
  }

  const documentBody = globalThis.document?.body ?? null;

  return (
    activeElement === waitAnchor ||
    (documentBody !== null && waitAnchor !== documentBody && waitAnchor.contains(activeElement)) ||
    activeElement === documentBody
  );
};

export const resolveComposerAutofocus = (
  state: ComposerAutofocusState,
  snapshot: ComposerAutofocusSnapshot,
): ComposerAutofocusResult => {
  const { displayedSessionId, isComposerInteractive, activeElement, focusInsideComposer } =
    snapshot;
  if (!displayedSessionId) {
    return {
      nextState: clearComposerAutofocusState(),
      shouldFocus: false,
    };
  }

  let nextState = state;
  if (state.lastDisplayedSessionId !== displayedSessionId) {
    if (isComposerInteractive) {
      return {
        nextState: {
          lastDisplayedSessionId: displayedSessionId,
          pendingAutofocusSessionId: null,
          waitAnchor: null,
        },
        shouldFocus: true,
      };
    }

    nextState = {
      lastDisplayedSessionId: displayedSessionId,
      pendingAutofocusSessionId: displayedSessionId,
      waitAnchor: activeElement,
    };
  }

  if (nextState.pendingAutofocusSessionId !== displayedSessionId || !isComposerInteractive) {
    return {
      nextState,
      shouldFocus: false,
    };
  }

  if (!didFocusStayOnWaitAnchor(nextState.waitAnchor, activeElement) && !focusInsideComposer) {
    return {
      nextState: completeComposerAutofocusState(nextState),
      shouldFocus: false,
    };
  }

  return {
    nextState: completeComposerAutofocusState(nextState),
    shouldFocus: true,
  };
};
