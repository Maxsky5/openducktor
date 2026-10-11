import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionHistoryMessage } from "@openducktor/core";

type Measurement = {
  view: string;
  reads: Record<string, number>;
  diskBytes: number;
  responseBytes: number;
  elapsedMs: number;
  result: AgentSessionHistoryMessage[];
};

// A subprocess isolates the real SDK filesystem bindings and native config from other suites.
test.each(["foreground", "background"])(
  "reads each Claude transcript once with a nested %s child",
  async (mode) => {
    const config = await mkdtemp(join(tmpdir(), "claude-history-read-"));
    try {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "claude-agent-sdk-history-read.test-support.ts")],
        {
          env: { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_HISTORY_EXECUTION_MODE: mode },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [output, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ code, error }).toEqual({ code: 0, error: "" });
      // SAFETY: The isolated fixture worker constructs this Measurement shape in the sibling support file.
      const measurements = JSON.parse(output) as Measurement[];
      const [root, selectedChild, todos] = measurements;
      expect(root!.reads).toEqual({
        "00000000-0000-4000-8000-000000000001.jsonl": 1,
        "00000000-0000-4000-8000-000000000001/subagents/agent-child.jsonl": 1,
        "00000000-0000-4000-8000-000000000001/subagents/team/agent-grandchild.jsonl": 1,
      });
      expect(selectedChild!.reads).toEqual(root!.reads);
      expect(todos!.reads).toEqual({ "00000000-0000-4000-8000-000000000001.jsonl": 1 });
      expect(root!.result).toHaveLength(703);
      expect(root!.result.flatMap((message) => message.parts)).toContainEqual(
        expect.objectContaining({
          kind: "subagent",
          status: "completed",
          externalSessionId: expect.stringContaining("::claude-subagent::child"),
        }),
      );
      expect(selectedChild!.result.flatMap((message) => message.parts)).toContainEqual(
        expect.objectContaining({
          kind: "subagent",
          status: "completed",
          externalSessionId: expect.stringContaining(
            "::claude-subagent::child::claude-subagent::grandchild",
          ),
        }),
      );
      expect(todos!.result).toEqual([]);
    } finally {
      await rm(config, { recursive: true, force: true });
    }
  },
);
