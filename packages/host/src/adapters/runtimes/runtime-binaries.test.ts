import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { resolveCodexBinary } from "./runtime-binaries";

const createSystemCommands = (): SystemCommandPort => ({
  async requiredCommandError(command) {
    return `Required command \`${command}\` not found.`;
  },
  async versionCommand() {
    return null;
  },
  async runCommandAllowFailure() {
    return { ok: false, stdout: "", stderr: "" };
  },
});

describe("resolveCodexBinary", () => {
  test("resolves a bundled Codex binary before PATH", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-runtime-binaries-"));
    try {
      const binDir = join(root, "bin");
      await mkdir(binDir);
      const codex = join(binDir, "codex");
      await writeFile(codex, "#!/bin/sh\n");
      await chmod(codex, 0o755);

      await expect(
        resolveCodexBinary(createSystemCommands(), {
          OPENDUCKTOR_BUNDLED_BIN_DIR: binDir,
        }),
      ).resolves.toBe(codex);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails when an explicit Codex override is not executable", async () => {
    await expect(
      resolveCodexBinary(createSystemCommands(), {
        OPENDUCKTOR_CODEX_BINARY: "/missing/codex",
      }),
    ).rejects.toThrow(
      "Configured Codex override OPENDUCKTOR_CODEX_BINARY points to a missing or non-executable file: /missing/codex",
    );
  });
});
