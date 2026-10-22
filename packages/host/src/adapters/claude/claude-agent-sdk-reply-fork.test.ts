import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each([
  ["fork", "forks the exact Claude reply with an idle child and leaves the active source intact"],
  ["history", "loads forked Claude history in its exact worktree after restart"],
] as const)("%s: %s", async (scenario) => {
  const config = await mkdtemp(join(tmpdir(), "claude-reply-fork-"));
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "test-support", "claude-reply-fork.ts"), scenario],
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
      expect(output.trim()).toBe(`Claude reply ${scenario} contracts verified.`);
    } finally {
      child.kill();
      await child.exited;
    }
  } finally {
    await rm(config, { recursive: true, force: true });
  }
});
