import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionHistoryMessage } from "@openducktor/core";

type Measurement = {
  view: string;
  reads: Record<string, number>;
  diskBytes: number;
  serializedBytes: number;
  responseBytes: number;
  elapsedMs: number;
  result: AgentSessionHistoryMessage[];
};

// A subprocess isolates the real SDK filesystem bindings and native config from other suites.
test.each([
  ["foreground", "normal"],
  ["background", "normal"],
  ["foreground", "long"],
])("reads only the selected transcript with a %s child at a %s path", async (mode, pathKind) => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-read-"));
  try {
    // The SDK shortens encoded project paths after 200 characters.
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
      // SAFETY: The isolated fixture worker constructs this Measurement shape in the sibling support file.
      const measurements = JSON.parse(output) as Measurement[];
      // Metadata reads must not serialize the fixture's full transcript into another copy.
      for (const measurement of measurements) {
        expect(measurement.serializedBytes).toBeLessThan(64 * 1024);
      }
      const [root, selectedChild, todos, nestedChild] = measurements;
      expect(Object.keys(root!.reads).some((path) => path.includes("subagents/"))).toBe(false);
      expect(root!.reads).toEqual({
        "00000000-0000-4000-8000-000000000001.jsonl": 2,
      });
      expect(selectedChild!.reads).toEqual({
        "00000000-0000-4000-8000-000000000001.jsonl": 1,
        "00000000-0000-4000-8000-000000000001/subagents/agent-child.jsonl": 1,
      });
      expect(todos!.reads).toEqual({ "00000000-0000-4000-8000-000000000001.jsonl": 2 });
      expect(nestedChild!.reads).toEqual({
        "00000000-0000-4000-8000-000000000001.jsonl": 1,
        "00000000-0000-4000-8000-000000000001/subagents/team/agent-grandchild.jsonl": 1,
      });
      expect(root!.result).toHaveLength(704);
      expect(root!.result.flatMap((message) => message.parts)).toContainEqual(
        expect.objectContaining({
          kind: "tool",
          tool: "Agent",
        }),
      );
      expect(selectedChild!.result).toContainEqual(
        expect.objectContaining({
          messageId: "child-user",
          role: "user",
          text: "Inspect the repository",
        }),
      );
      expect(selectedChild!.result.filter((message) => message.role === "user")).toHaveLength(1);
      expect(selectedChild!.result).toContainEqual(
        expect.objectContaining({
          role: "assistant",
          text: "Child done",
        }),
      );
      expect(nestedChild!.result).toContainEqual(
        expect.objectContaining({ role: "assistant", text: "Nested child done" }),
      );
      expect(
        root!.result.flatMap((message) => message.parts).some((part) => part.kind === "subagent"),
      ).toBe(false);
      expect(
        selectedChild!.result
          .flatMap((message) => message.parts)
          .some((part) => part.kind === "subagent"),
      ).toBe(false);
      expect(todos!.result).toEqual([]);
    } finally {
      child.kill();
      await child.exited;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
