import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("reads fresh Claude history while only startup bookkeeping has reached disk", async () => {
  const config = await mkdtemp(join(tmpdir(), "claude-history-startup-"));
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "claude-agent-sdk-history-startup.test-support.ts")],
      {
        env: { ...process.env, CLAUDE_CONFIG_DIR: config },
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
      const user = expect.objectContaining({
        messageId: "user-1",
        role: "user",
        text: "Inspect the repository.",
      });
      const unavailable = {
        code: "request_failed",
        message: "The selected Claude session is unavailable. Check its history on the host.",
      };
      expect(JSON.parse(output)).toEqual({
        starting: { history: [user] },
        stopped: unavailable,
        resumed: unavailable,
        detached: unavailable,
        persisted: { history: [user] },
        mismatch: { code: "scope_mismatch", message: expect.any(String) },
      });
    } finally {
      child.kill();
      await child.exited;
    }
  } finally {
    await rm(config, { recursive: true, force: true });
  }
});
