import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const zsh = Bun.which("zsh");
describe.skipIf(process.platform === "win32" || zsh === null)("zsh Action terminals", () => {
  let root: string;
  let script: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "odt-native-action-test-"));
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "../../testing/terminal-action-native.fixture.ts")],
      target: "node",
      plugins: [
        {
          name: "native-pty",
          setup(builder) {
            builder.onResolve({ filter: /^node-pty$/u }, () => ({
              path: Bun.resolveSync("node-pty", import.meta.dir),
              external: true,
            }));
          },
        },
      ],
    });
    expect(build.success).toBe(true);
    script = join(root, "probe.mjs");
    await writeFile(script, await build.outputs[0]!.text());
  });
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test.each([
    "submit",
    "close",
    "direct",
    "history",
    "state",
    "restart",
    "restart-setup",
    "restart-err-exit",
    "restart-finished",
    "interrupt-finished",
    "hooks",
    "manual-replay",
    "ready",
    "buffer",
  ])("%s", async (name) => {
    const child = Bun.spawn(["node", script, name], {
      env: { ...process.env, ODT_TEST_ZSH: zsh! },
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await child.exited).toBe(0);
  });
});
