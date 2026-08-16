import { describe, expect, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import { reconcileMountedTerminalTabs } from "./mounted-terminal-tabs";
import {
  emptyTerminalScopePresentation,
  type TerminalScopePresentation,
  type TerminalTab,
} from "./terminal-presentation-state";

// packages/host terminal limits: 32 live sessions + 64 retained exited sessions.
const RETAINED_TERMINAL_BOUND = 96;

const readyTab = (index: number): TerminalTab => {
  const terminalId = `terminal-${index}`;
  const summary: TerminalSummary = {
    terminalId,
    label: `Shell ${index}`,
    context: { repoPath: "/repo", taskId: `task-${index}` },
    initialWorkingDir: `/repo/task-${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 16, 0, 0, index)).toISOString(),
    lifecycle: "running",
    exit: null,
  };
  return {
    tabId: `tab:${terminalId}`,
    terminalId,
    summary,
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
  };
};

const scopeWithTab = (tab: TerminalTab): TerminalScopePresentation => ({
  ...emptyTerminalScopePresentation(),
  tabs: [tab],
});

describe("reconcileMountedTerminalTabs", () => {
  test("preserves all wrappers when only the active scope state changes at the host bound", () => {
    const scopeKeys = Array.from(
      { length: RETAINED_TERMINAL_BOUND },
      (_, index) => `/repo:task-${index}`,
    );
    const scopes = Object.fromEntries(
      scopeKeys.map((scopeKey, index) => [scopeKey, scopeWithTab(readyTab(index))]),
    );
    const first = reconcileMountedTerminalTabs(undefined, scopeKeys, scopes);
    const nextScopes = {
      ...scopes,
      [scopeKeys[RETAINED_TERMINAL_BOUND - 1] as string]: {
        ...(scopes[scopeKeys[RETAINED_TERMINAL_BOUND - 1] as string] as TerminalScopePresentation),
        visibility: { value: true, isExplicit: false },
      },
    };

    const second = reconcileMountedTerminalTabs(first, scopeKeys, nextScopes);

    expect(first.mountedTabs).toHaveLength(RETAINED_TERMINAL_BOUND);
    expect(second).toBe(first);
    expect(second.mountedTabs).toBe(first.mountedTabs);
  });

  test("replaces only the wrapper whose terminal tab changed", () => {
    const scopeKeys = ["/repo:task-a", "/repo:task-b"];
    const taskATab = readyTab(0);
    const taskBTab = readyTab(1);
    if (taskBTab.requestState !== "ready") throw new Error("Expected a ready terminal tab.");
    const scopes = {
      [scopeKeys[0] as string]: scopeWithTab(taskATab),
      [scopeKeys[1] as string]: scopeWithTab(taskBTab),
    };
    const first = reconcileMountedTerminalTabs(undefined, scopeKeys, scopes);
    const changedTaskBTab = { ...taskBTab, summary: { ...taskBTab.summary, label: "Renamed" } };
    const second = reconcileMountedTerminalTabs(first, scopeKeys, {
      ...scopes,
      [scopeKeys[1] as string]: scopeWithTab(changedTaskBTab),
    });

    expect(second).not.toBe(first);
    expect(second.mountedTabs[0]).toBe(first.mountedTabs[0]);
    expect(second.mountedTabs[1]).not.toBe(first.mountedTabs[1]);
  });
});
