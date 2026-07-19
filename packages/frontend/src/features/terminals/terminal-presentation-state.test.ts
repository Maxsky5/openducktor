import { describe, expect, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import {
  createTerminalPresentationState,
  terminalPresentationReducer,
} from "./terminal-presentation-state";

const summary = (terminalId: string): TerminalSummary => ({
  terminalId,
  label: terminalId,
  context: { repoPath: "/repo", taskId: "task-1" },
  initialWorkingDir: "/repo/task-1",
  createdAt: "2026-07-17T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
});

describe("terminalPresentationReducer", () => {
  test("shows a surviving tab when overlapping closes have mixed outcomes", () => {
    const scopeKey = "/repo:task-1";
    let state = createTerminalPresentationState(scopeKey);
    state = terminalPresentationReducer(state, {
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-1",
      summaries: [summary("terminal-a"), summary("terminal-b")],
    });
    state = terminalPresentationReducer(state, {
      type: "visibilitySet",
      scopeKey,
      value: true,
      isExplicit: true,
    });
    state = terminalPresentationReducer(state, {
      type: "closeStarted",
      scopeKey,
      tabId: "tab:terminal-a",
    });
    state = terminalPresentationReducer(state, {
      type: "closeStarted",
      scopeKey,
      tabId: "tab:terminal-b",
    });
    state = terminalPresentationReducer(state, {
      type: "closeRejected",
      scopeKey,
      tabId: "tab:terminal-a",
    });
    state = terminalPresentationReducer(state, {
      type: "closeCompleted",
      scopeKey,
      tabId: "tab:terminal-b",
    });

    expect(state.scopes[scopeKey]?.tabs.map((tab) => tab.tabId)).toEqual(["tab:terminal-a"]);
    expect(state.scopes[scopeKey]?.activeTabId).toBe("tab:terminal-a");
    expect(state.scopes[scopeKey]?.visibility.value).toBe(true);
  });

  test("does not turn an intentionally closing terminal into a lost tab", () => {
    const scopeKey = "/repo:task-1";
    let state = createTerminalPresentationState(scopeKey);
    state = terminalPresentationReducer(state, {
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-1",
      summaries: [summary("terminal-a")],
    });
    state = terminalPresentationReducer(state, {
      type: "closeStarted",
      scopeKey,
      tabId: "tab:terminal-a",
    });
    state = terminalPresentationReducer(state, {
      type: "terminalForgotten",
      scopeKey,
      terminalId: "terminal-a",
      message: "Terminal terminal-a was forgotten.",
    });

    expect(state.scopes[scopeKey]?.tabs).toMatchObject([
      { tabId: "tab:terminal-a", terminalId: "terminal-a", requestState: "ready" },
    ]);

    state = terminalPresentationReducer(state, {
      type: "closeCompleted",
      scopeKey,
      tabId: "tab:terminal-a",
    });
    expect(state.scopes[scopeKey]?.tabs).toEqual([]);
  });

  test("keeps terminal identity stable when a stale close follows a forgotten event", () => {
    const scopeKey = "/repo:task-1";
    let state = createTerminalPresentationState(scopeKey);
    state = terminalPresentationReducer(state, {
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-1",
      summaries: [summary("terminal-a")],
    });
    state = terminalPresentationReducer(state, {
      type: "terminalForgotten",
      scopeKey,
      terminalId: "terminal-a",
      message: "Terminal terminal-a was forgotten.",
    });

    expect(state.scopes[scopeKey]?.tabs).toMatchObject([
      { tabId: "tab:terminal-a", terminalId: null, requestState: "lost" },
    ]);

    state = terminalPresentationReducer(state, {
      type: "closeStarted",
      scopeKey,
      tabId: "tab:terminal-a",
    });
    state = terminalPresentationReducer(state, {
      type: "closeCompleted",
      scopeKey,
      tabId: "tab:terminal-a",
    });

    expect(state.scopes[scopeKey]?.tabs).toEqual([]);
  });
});
