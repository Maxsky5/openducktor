import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const zsh = Bun.which("zsh");
test
  .skipIf(process.platform === "win32" || zsh === null)
  .each(["history", "state", "restart", "hooks", "manual", "ready"])(
  "zsh Action terminals: %s",
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), "odt-native-action-test-"));
    try {
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
      const script = join(root, "probe.mjs");
      await writeFile(script, await build.outputs[0]!.text());
      const child = Bun.spawn([Bun.which("node")!, script, name], {
        env: { ...process.env, ODT_TEST_ZSH: zsh! },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(stdout).toContain(`PASS ${name}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
