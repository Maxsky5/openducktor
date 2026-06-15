import { describe, expect, test } from "bun:test";
import {
  createComposerAutofocusState,
  resolveComposerAutofocus,
} from "./agent-chat-composer-autofocus";

describe("resolveComposerAutofocus", () => {
  test("starts a pending request instead of focusing when a new session is still disabled", () => {
    const waitAnchor = document.createElement("button");
    const result = resolveComposerAutofocus(createComposerAutofocusState(), {
      displayedSessionKey: "session-1",
      isComposerInteractive: false,
      activeElement: waitAnchor,
      focusInsideComposer: false,
    });

    expect(result.shouldFocus).toBe(false);
    expect(result.nextState).toEqual({
      lastDisplayedSessionKey: "session-1",
      pendingAutofocusSessionKey: "session-1",
      waitAnchor,
    });
  });

  test("focuses immediately when a new displayed session is interactive", () => {
    const result = resolveComposerAutofocus(createComposerAutofocusState(), {
      displayedSessionKey: "session-1",
      isComposerInteractive: true,
      activeElement: document.body,
      focusInsideComposer: false,
    });

    expect(result.shouldFocus).toBe(true);
    expect(result.nextState).toEqual({
      lastDisplayedSessionKey: "session-1",
      pendingAutofocusSessionKey: null,
      waitAnchor: null,
    });
  });

  test("focuses immediately when a new displayed session replaces another active control", () => {
    const result = resolveComposerAutofocus(createComposerAutofocusState(), {
      displayedSessionKey: "session-1",
      isComposerInteractive: true,
      activeElement: document.createElement("button"),
      focusInsideComposer: false,
    });

    expect(result.shouldFocus).toBe(true);
    expect(result.nextState).toEqual({
      lastDisplayedSessionKey: "session-1",
      pendingAutofocusSessionKey: null,
      waitAnchor: null,
    });
  });

  test("focuses when the same displayed session becomes interactive and focus did not move", () => {
    const waitAnchor = document.createElement("button");
    const pendingResult = resolveComposerAutofocus(createComposerAutofocusState(), {
      displayedSessionKey: "session-1",
      isComposerInteractive: false,
      activeElement: waitAnchor,
      focusInsideComposer: false,
    });

    const result = resolveComposerAutofocus(pendingResult.nextState, {
      displayedSessionKey: "session-1",
      isComposerInteractive: true,
      activeElement: waitAnchor,
      focusInsideComposer: false,
    });

    expect(result.shouldFocus).toBe(true);
    expect(result.nextState.pendingAutofocusSessionKey).toBeNull();
    expect(result.nextState.waitAnchor).toBeNull();
  });

  test("skips delayed focus when the user moved to another control", () => {
    const initialButton = document.createElement("button");
    const laterButton = document.createElement("button");
    const pendingResult = resolveComposerAutofocus(createComposerAutofocusState(), {
      displayedSessionKey: "session-1",
      isComposerInteractive: false,
      activeElement: initialButton,
      focusInsideComposer: false,
    });

    const result = resolveComposerAutofocus(pendingResult.nextState, {
      displayedSessionKey: "session-1",
      isComposerInteractive: true,
      activeElement: laterButton,
      focusInsideComposer: false,
    });

    expect(result.shouldFocus).toBe(false);
    expect(result.nextState.pendingAutofocusSessionKey).toBeNull();
    expect(result.nextState.waitAnchor).toBeNull();
  });

  test("does not refocus during same-session rerenders after autofocus was already consumed", () => {
    const focusedResult = resolveComposerAutofocus(createComposerAutofocusState(), {
      displayedSessionKey: "session-1",
      isComposerInteractive: true,
      activeElement: document.body,
      focusInsideComposer: false,
    });

    const result = resolveComposerAutofocus(focusedResult.nextState, {
      displayedSessionKey: "session-1",
      isComposerInteractive: true,
      activeElement: document.createElement("button"),
      focusInsideComposer: false,
    });

    expect(result.shouldFocus).toBe(false);
    expect(result.nextState).toEqual(focusedResult.nextState);
  });

  test("clears pending autofocus when no session is displayed", () => {
    const pendingResult = resolveComposerAutofocus(createComposerAutofocusState(), {
      displayedSessionKey: "session-1",
      isComposerInteractive: false,
      activeElement: document.createElement("button"),
      focusInsideComposer: false,
    });

    const result = resolveComposerAutofocus(pendingResult.nextState, {
      displayedSessionKey: null,
      isComposerInteractive: false,
      activeElement: document.createElement("button"),
      focusInsideComposer: false,
    });

    expect(result.shouldFocus).toBe(false);
    expect(result.nextState).toEqual(createComposerAutofocusState());
  });
});
