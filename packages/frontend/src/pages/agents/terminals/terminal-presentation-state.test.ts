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
});
