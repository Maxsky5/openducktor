import { describe, expect, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import type { TerminalTab } from "./terminal-presentation-state";
import { terminalCloseNeedsConfirmation } from "./terminal-tab-presentation";

const summary: TerminalSummary = {
  terminalId: "terminal-1",
  label: "Shell",
  context: { repoPath: "/repo", taskId: "task-1" },
  initialWorkingDir: "/repo/task-1",
  createdAt: "2026-07-17T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
  startedBy: "user",
};

const readyTab: TerminalTab = {
  tabId: "tab:terminal-1",
  terminalId: "terminal-1",
  summary,
  awaitingLifecycleSync: false,
  error: null,
  requestState: "ready",
};

describe("terminalCloseNeedsConfirmation", () => {
  test("asks before it closes a terminal that runs a command", () => {
    expect(terminalCloseNeedsConfirmation(readyTab, new Set(["terminal-1"]))).toBe(true);
    expect(terminalCloseNeedsConfirmation(readyTab, new Set())).toBe(false);
  });

  test("closes a terminal that the host does not know without a question", () => {
    const lostTab: TerminalTab = {
      tabId: "tab:terminal-1",
      terminalId: null,
      summary: null,
      label: "Shell",
      error: "The host restarted.",
      requestState: "lost",
      sourceTerminalId: "terminal-1",
    };
    expect(terminalCloseNeedsConfirmation(lostTab, new Set(["terminal-1"]))).toBe(false);
  });
});
