export type ComposerAutofocusState = {
  lastDisplayedSessionKey: string | null;
  pendingAutofocusSessionKey: string | null;
  waitAnchor: Element | null;
};

export type ComposerAutofocusSnapshot = {
  displayedSessionKey: string | null;
  isComposerInteractive: boolean;
  activeElement: Element | null;
  focusInsideComposer: boolean;
};

export type ComposerAutofocusResult = {
  nextState: ComposerAutofocusState;
  shouldFocus: boolean;
};

export const createComposerAutofocusState = (): ComposerAutofocusState => ({
  lastDisplayedSessionKey: null,
  pendingAutofocusSessionKey: null,
  waitAnchor: null,
});

const clearComposerAutofocusState = (): ComposerAutofocusState => createComposerAutofocusState();

const completeComposerAutofocusState = (state: ComposerAutofocusState): ComposerAutofocusState => ({
  ...state,
  pendingAutofocusSessionKey: null,
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
  const { displayedSessionKey, isComposerInteractive, activeElement, focusInsideComposer } =
    snapshot;
  if (!displayedSessionKey) {
    return {
      nextState: clearComposerAutofocusState(),
      shouldFocus: false,
    };
  }

  let nextState = state;
  if (state.lastDisplayedSessionKey !== displayedSessionKey) {
    if (isComposerInteractive) {
      return {
        nextState: {
          lastDisplayedSessionKey: displayedSessionKey,
          pendingAutofocusSessionKey: null,
          waitAnchor: null,
        },
        shouldFocus: true,
      };
    }

    nextState = {
      lastDisplayedSessionKey: displayedSessionKey,
      pendingAutofocusSessionKey: displayedSessionKey,
      waitAnchor: activeElement,
    };
  }

  if (nextState.pendingAutofocusSessionKey !== displayedSessionKey || !isComposerInteractive) {
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
