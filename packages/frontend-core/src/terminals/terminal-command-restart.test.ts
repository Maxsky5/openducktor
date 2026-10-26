import { describe, expect, test } from "bun:test";
import type { TerminalActivity, TerminalRestartRequest } from "@openducktor/contracts";
import type { TerminalActivityState } from "./terminal-activity-store";
import { findTerminalActivity, restartTerminalCommand } from "./terminal-command-restart";

const activity = (command: string, terminalId = "terminal-1"): TerminalActivity => ({
  command,
  restartable: true,
  summary: {
    terminalId,
    label: command,
    initialWorkingDir: "/repo",
    context: { repoPath: "/repo", taskId: "task-1" },
    lifecycle: "running",
    createdAt: "2026-10-14T00:00:00Z",
    exit: null,
    startedBy: "user",
  },
});
const ready = (...commands: TerminalActivity[]): TerminalActivityState => ({
  status: "ready",
  commands,
  error: null,
});

describe("findTerminalActivity", () => {
  test("finds the command of the terminal only after the activity stream is ready", () => {
    const dev = activity("bun dev");
    expect(findTerminalActivity(ready(activity("bun test", "terminal-2"), dev), "terminal-1")).toBe(
      dev,
    );
    expect(
      findTerminalActivity({ status: "loading", commands: [dev], error: null }, "terminal-1"),
    ).toBeUndefined();
  });
});

describe("restartTerminalCommand", () => {
  test("restarts only the command that the activity stream reported", async () => {
    const requests: TerminalRestartRequest[] = [];
    await restartTerminalCommand(
      activity("bun dev"),
      () => ready(activity("bun dev")),
      async (request) => {
        requests.push(request);
        return { restarted: true };
      },
    );
    expect(requests).toEqual([{ terminalId: "terminal-1", expectedCommand: "bun dev" }]);
  });

  test("rejects with the failure while the command stays the same or after it ended", async () => {
    const failure = new Error("The command did not stop. Stop it in the terminal.");
    for (const latest of [ready(activity("bun dev")), ready()]) {
      const result = await restartTerminalCommand(
        activity("bun dev"),
        () => latest,
        async () => {
          throw failure;
        },
      ).catch((cause: unknown) => cause);
      expect(result).toBe(failure);
    }
  });

  test("drops the failure of a command that changed during the restart", async () => {
    const result = await restartTerminalCommand(
      activity("bun dev"),
      () => ready(activity("bun test")),
      async () => {
        throw new Error("The running command changed.");
      },
    ).then(
      () => "resolved",
      () => "rejected",
    );
    expect(result).toBe("resolved");
  });
});
