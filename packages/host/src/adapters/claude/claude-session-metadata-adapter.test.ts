import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const runMetadata = async (config: string, ...args: string[]): Promise<string> => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "test-support", "claude-session-metadata.ts"),
      ...args,
    ],
    {
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 4_000,
      killSignal: "SIGKILL",
    },
  );
  try {
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    return output.trim();
  } finally {
    child.kill();
    await child.exited;
  }
};

test("reads a native fork's original directory after both worktrees are removed and the host restarts", async () => {
  const config = await mkdtemp(join(tmpdir(), "claude-session-metadata-"));
  try {
    const saved = z
      .object({ externalSessionId: z.string(), workingDirectory: z.string() })
      .parse(JSON.parse(await runMetadata(config, "prepare-fork")));
    const workingDirectory = JSON.parse(await runMetadata(config, "read", saved.externalSessionId));
    expect(workingDirectory).toBe(saved.workingDirectory);
  } finally {
    await rm(config, { recursive: true, force: true });
  }
});

test("returns actionable typed failures for unavailable or invalid Claude metadata", async () => {
  const config = await mkdtemp(join(tmpdir(), "claude-session-metadata-errors-"));
  try {
    expect(await runMetadata(config, "failures")).toBe("Claude metadata failures verified.");
  } finally {
    await rm(config, { recursive: true, force: true });
  }
});
