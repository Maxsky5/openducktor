import { describe, expect, test } from "bun:test";
import type { AgentSessionBackgroundTask } from "@openducktor/contracts";
import { buildBackgroundTaskRows } from "./background-task-bar";

const server: AgentSessionBackgroundTask = {
  taskId: "shell-1",
  kind: "command",
  title: "bun run dev",
  stop: { allowed: true },
};
const reviewer: AgentSessionBackgroundTask = {
  taskId: "agent-1",
  kind: "subagent",
  title: "reviewer",
  description: "Review the diff",
  stop: { allowed: false, reason: "Codex 0.140.0 or later can stop it." },
};

describe("buildBackgroundTaskRows", () => {
  test("keeps the snapshot order and names each kind", () => {
    const rows = buildBackgroundTaskRows([server, reviewer], new Map());

    expect(rows.map((row) => [row.taskId, row.kindLabel, row.description])).toEqual([
      ["shell-1", "Command", null],
      ["agent-1", "Subagent", "Review the diff"],
    ]);
  });

  test("shows the request state, and the runtime reason when the task cannot stop", () => {
    const rows = buildBackgroundTaskRows(
      [server, reviewer],
      new Map([
        ["shell-1", { kind: "failed", reason: "Shell not found" }],
        ["agent-1", { kind: "stopping" }],
      ]),
    );

    expect(rows.map((row) => row.stop)).toEqual([
      { control: { label: "Stop", busy: false }, note: { text: "Shell not found", tone: "error" } },
      { control: null, note: { text: "Codex 0.140.0 or later can stop it.", tone: "muted" } },
    ]);
  });

  test("offers Stop, and shows Stopping while the stop runs", () => {
    const allowed = { ...server, stop: { allowed: true } } as const;
    const [available] = buildBackgroundTaskRows([allowed], new Map());
    const [stopping] = buildBackgroundTaskRows(
      [allowed],
      new Map([["shell-1", { kind: "stopping" }]]),
    );

    expect(available?.stop).toEqual({ control: { label: "Stop", busy: false }, note: null });
    expect(stopping?.stop).toEqual({ control: { label: "Stopping", busy: true }, note: null });
  });

  test("names the task in the confirmation, and says that a subagent stops early", () => {
    const [command, subagent] = buildBackgroundTaskRows([server, reviewer], new Map());

    expect(command?.confirmation).toEqual({
      title: "Stop this command?",
      description: 'The command "bun run dev" stops. The agent and the other tasks continue.',
      confirmLabel: "Stop",
    });
    expect(subagent?.confirmation.description).toBe(
      'The subagent "reviewer" stops before it finishes its work. The agent and the other tasks continue.',
    );
  });
});
