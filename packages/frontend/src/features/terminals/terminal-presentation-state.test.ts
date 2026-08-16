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
  test("preserves state identity when the host list has no material change", () => {
    const scopeKey = "/repo:task-1";
    const terminal = summary("terminal-a");
    const initial = terminalPresentationReducer(createTerminalPresentationState(scopeKey), {
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-1",
      summaries: [terminal],
    });

    const repeated = terminalPresentationReducer(initial, {
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-1",
      summaries: [{ ...terminal, context: { ...terminal.context } }],
    });

    expect(repeated).toBe(initial);
    expect(repeated.scopes[scopeKey]).toBe(initial.scopes[scopeKey]);
    expect(repeated.scopes[scopeKey]?.tabs).toBe(initial.scopes[scopeKey]?.tabs);
  });

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

  test("does not restore a forgotten terminal from a stale host list", () => {
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
    state = terminalPresentationReducer(state, {
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-1",
      summaries: [summary("terminal-a")],
    });

    expect(state.scopes[scopeKey]?.tabs).toMatchObject([
      {
        tabId: "tab:terminal-a",
        terminalId: null,
        requestState: "lost",
        sourceTerminalId: "terminal-a",
      },
    ]);
  });

  test("does not restore a forgotten terminal after the host restarts", () => {
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
    state = terminalPresentationReducer(state, {
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-2",
      summaries: [summary("terminal-a")],
    });

    expect(state.scopes[scopeKey]?.tabs).toMatchObject([
      {
        tabId: "tab:terminal-a",
        terminalId: null,
        requestState: "lost",
        sourceTerminalId: "terminal-a",
      },
    ]);
  });

  test("does not reactivate a tab removed before close rejection", () => {
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
      type: "hostSynced",
      scopeKey,
      hostInstanceId: "host-1",
      summaries: [],
    });
    state = terminalPresentationReducer(state, {
      type: "closeRejected",
      scopeKey,
      tabId: "tab:terminal-a",
    });

    expect(state.scopes[scopeKey]?.tabs).toEqual([]);
    expect(state.scopes[scopeKey]?.activeTabId).toBeNull();
  });
});
