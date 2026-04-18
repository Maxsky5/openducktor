export type ComposerAutofocusState = {
  lastDisplayedSessionId: string | null;
  pendingAutofocusSessionId: string | null;
  waitAnchor: HTMLElement | null;
};

export type ComposerAutofocusSnapshot = {
  displayedSessionId: string | null;
  isComposerInteractive: boolean;
  activeElement: HTMLElement | null;
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

const clearComposerAutofocusState = (): ComposerAutofocusState => ({
  lastDisplayedSessionId: null,
  pendingAutofocusSessionId: null,
  waitAnchor: null,
});

const completeComposerAutofocusState = (state: ComposerAutofocusState): ComposerAutofocusState => ({
  ...state,
  pendingAutofocusSessionId: null,
  waitAnchor: null,
});

const didFocusStayOnWaitAnchor = (
  waitAnchor: HTMLElement | null,
  activeElement: HTMLElement | null,
): boolean => {
  if (!waitAnchor || !activeElement) {
    return true;
  }

  return (
    activeElement === waitAnchor ||
    (waitAnchor !== document.body && waitAnchor.contains(activeElement)) ||
    activeElement === document.body
  );
};

const shouldFocusImmediatelyForNewSession = (
  activeElement: HTMLElement | null,
  focusInsideComposer: boolean,
): boolean => {
  if (focusInsideComposer || !activeElement) {
    return true;
  }

  return activeElement === document.body;
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
        shouldFocus: shouldFocusImmediatelyForNewSession(activeElement, focusInsideComposer),
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
