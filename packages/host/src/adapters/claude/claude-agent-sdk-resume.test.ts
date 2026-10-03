import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// A real CLI process keeps SDK spies in other tests out of this admission check.
test("resumes an interrupted turn after an API error older than six hours", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./claude-agent-sdk-resume.test-support.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain("Continuation admitted without a new user message.");
  } finally {
    child.kill();
    await child.exited;
  }
}, 10_000);
