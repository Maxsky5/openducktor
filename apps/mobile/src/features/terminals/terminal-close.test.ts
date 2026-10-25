import { describe, expect, mock, test } from "bun:test";
import type { TerminalCloseResponse } from "@openducktor/contracts";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { remoteError } from "@openducktor/host-client/remote";
import { closeTerminalTab, type TerminalCloseModel } from "./terminal-close";

const tab: TerminalTab = {
  tabId: "tab:t-1",
  terminalId: "t-1",
  summary: {
    terminalId: "t-1",
    label: "dev server",
    context: { repoPath: "/repo", taskId: "task-1" },
    initialWorkingDir: "/repo",
    createdAt: "2026-10-19T00:00:00.000Z",
    lifecycle: "running",
    exit: null,
    startedBy: "user",
  },
  awaitingLifecycleSync: false,
  error: null,
  requestState: "ready",
};

const closeModel = (
  results: Array<TerminalCloseResponse | Error>,
  running: string[] = [],
): TerminalCloseModel & { calls: boolean[] } => {
  const calls: boolean[] = [];
  return {
    calls,
    runningCommandTerminalIds: new Set(running),
    onClose: async (_tab, confirmTerminate) => {
      calls.push(confirmTerminate);
      const result = results.shift();
      if (result instanceof Error) throw result;
      if (!result) throw new Error("No close result.");
      return result;
    },
  };
};

describe("closeTerminalTab", () => {
  test("closes an idle terminal without asking", async () => {
    const model = closeModel([{ closed: true }]);
    const confirm = mock(async () => true);
    expect(await closeTerminalTab(model, tab, confirm)).toEqual({ kind: "closed" });
    expect(model.calls).toEqual([false]);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("asks when the host reports running child processes", async () => {
    const model = closeModel([{ closed: false, confirmationRequired: true }, { closed: true }]);
    const confirm = mock(async () => true);
    expect(await closeTerminalTab(model, tab, confirm)).toEqual({ kind: "closed" });
    expect(model.calls).toEqual([false, true]);
    expect(confirm).toHaveBeenCalledWith("dev server");
  });

  test("keeps the terminal when the user cancels", async () => {
    const model = closeModel([{ closed: false, confirmationRequired: true }]);
    expect(await closeTerminalTab(model, tab, async () => false)).toEqual({ kind: "kept" });
    expect(model.calls).toEqual([false]);
  });

  test("asks first for a terminal that runs a command", async () => {
    const declined = closeModel([], ["t-1"]);
    expect(await closeTerminalTab(declined, tab, async () => false)).toEqual({ kind: "kept" });
    expect(declined.calls).toEqual([]);
    const confirmed = closeModel([{ closed: true }], ["t-1"]);
    expect(await closeTerminalTab(confirmed, tab, async () => true)).toEqual({ kind: "closed" });
    expect(confirmed.calls).toEqual([true]);
  });

  test("reports a lost close result once with the host guidance", async () => {
    const model = closeModel([
      remoteError("outcome_unknown", "The close result was lost.", "Check the terminal list."),
    ]);
    expect(await closeTerminalTab(model, tab, async () => true)).toEqual({
      kind: "unknown",
      guidance: "Check the terminal list.",
    });
    expect(model.calls).toEqual([false]);
  });

  test("reports other failures with their message", async () => {
    const model = closeModel([new Error("The terminal is closing.")]);
    expect(await closeTerminalTab(model, tab, async () => true)).toEqual({
      kind: "failed",
      message: "The terminal is closing.",
    });
  });
});
