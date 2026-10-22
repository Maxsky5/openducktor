import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionHistoryMessage, AgentSessionTodoItem } from "@openducktor/core";

type Measurement = {
  view: string;
  reads: Record<string, number>;
  diskBytes: number;
  selectedBytes: number;
  serializedBytes: number;
  responseBytes: number;
  elapsedMs: number;
  result: AgentSessionHistoryMessage[];
};
type TodoMeasurement = Omit<Measurement, "result"> & { result: AgentSessionTodoItem[] };

// A subprocess isolates filesystem instrumentation and native config from other suites.
test.each([
  ["foreground", "normal"],
  ["background", "normal"],
  ["foreground", "long"],
])(
  "loads selected content and needed child summaries with a %s child at a %s path",
  async (mode, pathKind) => {
    const root = await mkdtemp(join(tmpdir(), "claude-history-read-"));
    try {
      // The config path must not depend on the SDK's project-path shortening rule.
      const config = pathKind === "long" ? join(root, "nested-".repeat(25)) : root;
      await mkdir(config, { recursive: true });
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "claude-agent-sdk-history-read.test-support.ts")],
        {
          env: { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_HISTORY_EXECUTION_MODE: mode },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 4_000,
          killSignal: "SIGKILL",
        },
      );
      try {
        const [output, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect({ code, error }).toEqual({ code: 0, error: "" });
        // SAFETY: The isolated fixture worker returns these four views in this order.
        const measurements = JSON.parse(output) as [
          Measurement,
          Measurement,
          TodoMeasurement,
          Measurement,
        ];
        // Metadata reads must not serialize the fixture's full transcript into another copy.
        for (const measurement of measurements) {
          expect(measurement.serializedBytes).toBeLessThan(64 * 1024);
        }
        const [root, selectedChild, todos, nestedChild] = measurements;
        const rootPath = "00000000-0000-4000-8000-000000000001.jsonl";
        expect(Object.keys(root.reads)).toEqual([rootPath]);
        expect(Object.keys(todos.reads)).toEqual([rootPath]);
        expect(Object.keys(selectedChild.reads).sort()).toEqual([
          rootPath,
          "00000000-0000-4000-8000-000000000001/subagents/agent-child.jsonl",
          "00000000-0000-4000-8000-000000000001/subagents/team/agent-grandchild.jsonl",
        ]);
        expect(Object.keys(nestedChild.reads).sort()).toEqual([
          rootPath,
          "00000000-0000-4000-8000-000000000001/subagents/team/agent-grandchild.jsonl",
        ]);
        for (const measurement of [root, todos]) {
          expect(measurement.diskBytes).toBe(measurement.selectedBytes);
        }
        for (const measurement of [selectedChild, nestedChild]) {
          expect(measurement.diskBytes).toBeGreaterThanOrEqual(measurement.selectedBytes);
          const childSummaryBytes = measurement === selectedChild ? nestedChild.selectedBytes : 0;
          expect(measurement.diskBytes).toBeLessThanOrEqual(
            measurement.selectedBytes + root.selectedBytes + childSummaryBytes,
          );
        }
        expect(root.result).toContainEqual(
          expect.objectContaining({ role: "user", text: "Inspect the repository" }),
        );
        expect(root.result).toContainEqual(
          expect.objectContaining({
            role: "assistant",
            text: expect.stringContaining("Message 700 "),
          }),
        );
        expect(root.result.flatMap((message) => message.parts)).toContainEqual(
          expect.objectContaining({
            kind: "tool",
            tool: "Agent",
          }),
        );
        expect(selectedChild.result).toContainEqual(
          expect.objectContaining({
            messageId: "child-user",
            role: "user",
            text: "Inspect the repository",
          }),
        );
        expect(selectedChild.result.filter((message) => message.role === "user")).toHaveLength(1);
        expect(selectedChild.result).toContainEqual(
          expect.objectContaining({
            role: "assistant",
            text: "Child done",
          }),
        );
        expect(nestedChild.result).toContainEqual(
          expect.objectContaining({ role: "assistant", text: "Nested child done" }),
        );
        expect(root.result.flatMap((message) => message.parts)).toContainEqual(
          expect.objectContaining({
            kind: "subagent",
            externalSessionId: "00000000-0000-4000-8000-000000000001::claude-subagent::child",
            executionMode: mode,
            status: "completed",
          }),
        );
        expect(selectedChild.result.flatMap((message) => message.parts)).toContainEqual(
          expect.objectContaining({
            kind: "subagent",
            externalSessionId:
              "00000000-0000-4000-8000-000000000001::claude-subagent::child::claude-subagent::grandchild",
            executionMode: mode,
            status: "completed",
          }),
        );
        expect(todos.result).toEqual([
          { id: "1", content: "Inspect stored task", status: "pending", priority: "medium" },
        ]);
      } finally {
        child.kill();
        await child.exited;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
