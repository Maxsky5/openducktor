import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystemCommandRunner } from "./system-command-runner";

describe("createSystemCommandRunner", () => {
  test("resolves required commands from its explicit environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-system-command-"));
    try {
      const executable = join(root, "custom-tool");
      await writeFile(executable, "#!/bin/sh\nexit 0\n");
      await chmod(executable, 0o755);

      const port = createSystemCommandRunner({
        env: { PATH: root },
        platform: "darwin",
      });

      await expect(port.requiredCommandError("custom-tool")).resolves.toBeNull();
      await expect(port.requiredCommandError("missing-tool")).resolves.toBe(
        "Required command `missing-tool` not found. Install missing-tool and ensure it is available on PATH.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("passes the explicit environment to spawned commands", async () => {
    const port = createSystemCommandRunner({
      env: {
        PATH: process.env.PATH,
        OPENDUCKTOR_TEST_VALUE: "from-host-env",
      },
      platform: process.platform,
    });

    const result = await port.runCommandAllowFailure("bun", [
      "-e",
      "console.log(process.env.OPENDUCKTOR_TEST_VALUE)",
    ]);

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("from-host-env");
  });
});
