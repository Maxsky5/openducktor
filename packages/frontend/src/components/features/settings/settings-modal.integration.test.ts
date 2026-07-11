import { expect, test } from "bun:test";

test("SettingsModal Agent Studio target integration cases pass in an isolated Bun process", async () => {
  const testFile = `${import.meta.dir}/settings-modal.integration-cases.tsx`;
  const subprocess = Bun.spawn([process.execPath, "test", testFile], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
}, 10_000);
