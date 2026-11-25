import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Git setup and SDK transcript reads take several seconds on Windows.
test("forks the exact Claude reply and reloads its history in the fork worktree after restart", async () => {
  const config = await mkdtemp(join(tmpdir(), "claude-reply-fork-"));
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "test-support", "claude-reply-fork.ts")],
      {
        env: { ...process.env, CLAUDE_CONFIG_DIR: config },
        stdout: "inherit",
        stderr: "inherit",
        timeout: 8_000,
        killSignal: "SIGKILL",
      },
    );
    expect(await child.exited).toBe(0);
  } finally {
    await rm(config, { recursive: true, force: true });
  }
}, 10_000);
