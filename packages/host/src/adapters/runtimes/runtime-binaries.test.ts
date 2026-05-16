import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { resolveCodexBinary, resolveOpencodeBinary } from "./runtime-binaries";

const createSystemCommands = ({
  available = [],
}: {
  available?: string[];
} = {}): SystemCommandPort => ({
  async requiredCommandError(command) {
    return available.includes(command) ? null : `Required command \`${command}\` not found.`;
  },
  async versionCommand() {
    return null;
  },
  async runCommandAllowFailure() {
    return { ok: false, stdout: "", stderr: "" };
  },
});

const withTempDir = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-runtime-binaries-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const writeExecutable = async (path: string): Promise<void> => {
  await writeFile(path, "");
  await chmod(path, 0o755);
};

describe("resolveOpencodeBinary", () => {
  test("resolves an explicit OpenCode override", async () => {
    await withTempDir(async (root) => {
      const opencode = join(root, "opencode");
      await writeExecutable(opencode);

      await expect(
        resolveOpencodeBinary(createSystemCommands(), {
          OPENDUCKTOR_OPENCODE_BINARY: opencode,
        }),
      ).resolves.toBe(opencode);
    });
  });

  test("fails when an explicit OpenCode override is empty", async () => {
    await expect(
      resolveOpencodeBinary(createSystemCommands(), {
        OPENDUCKTOR_OPENCODE_BINARY: " ",
      }),
    ).rejects.toThrow("Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY is empty");
  });

  test("fails when an explicit OpenCode override is not runnable", async () => {
    await expect(
      resolveOpencodeBinary(createSystemCommands(), {
        OPENDUCKTOR_OPENCODE_BINARY: "/missing/opencode",
      }),
    ).rejects.toThrow(
      "Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY points to a missing or non-executable file: /missing/opencode",
    );
  });

  test("expands quoted home-relative OpenCode overrides", async () => {
    await withTempDir(async (root) => {
      const binDir = join(root, "bin");
      await mkdir(binDir);
      const opencode = join(binDir, "opencode");
      await writeExecutable(opencode);

      await expect(
        resolveOpencodeBinary(
          createSystemCommands(),
          {
            OPENDUCKTOR_OPENCODE_BINARY: `"~/bin/opencode"`,
          },
          { homeDir: root },
        ),
      ).resolves.toBe(opencode);
    });
  });

  test("resolves the POSIX standard OpenCode install path before PATH", async () => {
    await withTempDir(async (root) => {
      const binDir = join(root, ".opencode", "bin");
      await mkdir(binDir, { recursive: true });
      const opencode = join(binDir, "opencode");
      await writeExecutable(opencode);

      await expect(
        resolveOpencodeBinary(
          createSystemCommands({ available: ["opencode"] }),
          {},
          { homeDir: root, platform: "linux" },
        ),
      ).resolves.toBe(opencode);
    });
  });

  test("resolves the Windows standard OpenCode install path", async () => {
    await withTempDir(async (root) => {
      const binDir = join(root, ".opencode", "bin");
      await mkdir(binDir, { recursive: true });
      const opencode = join(binDir, "opencode.exe");
      await writeFile(opencode, "");

      await expect(
        resolveOpencodeBinary(createSystemCommands(), {}, { homeDir: root, platform: "win32" }),
      ).resolves.toBe(opencode);
    });
  });

  test("uses PATH fallback after OpenCode override and standard locations", async () => {
    await expect(
      resolveOpencodeBinary(createSystemCommands({ available: ["opencode"] }), {}),
    ).resolves.toBe("opencode");
  });

  test("returns the resolved Windows PATHEXT OpenCode path for PATH fallback", async () => {
    await withTempDir(async (root) => {
      const opencode = join(root, "opencode.cmd");
      await writeFile(opencode, "");
      const systemCommands = createSystemCommandRunner({
        env: { PATH: root, PATHEXT: ".cmd" },
        platform: "win32",
      });

      await expect(
        resolveOpencodeBinary(
          systemCommands,
          { PATH: root, PATHEXT: ".cmd" },
          { platform: "win32" },
        ),
      ).resolves.toBe(opencode);
    });
  });

  test("reports considered OpenCode locations when missing", async () => {
    await expect(
      resolveOpencodeBinary(
        createSystemCommands(),
        {},
        { homeDir: "/home/alice", platform: "linux" },
      ),
    ).rejects.toThrow(
      "opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY, standard install location /home/alice/.opencode/bin/opencode, and PATH. Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.",
    );
  });
});

describe("resolveCodexBinary", () => {
  test("uses an explicit Codex override before bundled locations and PATH", async () => {
    await withTempDir(async (root) => {
      const override = join(root, "codex");
      await writeExecutable(override);
      const binDir = join(root, "bin");
      await mkdir(binDir);
      await writeExecutable(join(binDir, "codex"));

      await expect(
        resolveCodexBinary(createSystemCommands({ available: ["codex"] }), {
          OPENDUCKTOR_CODEX_BINARY: override,
          OPENDUCKTOR_BUNDLED_BIN_DIR: binDir,
        }),
      ).resolves.toBe(override);
    });
  });

  test("resolves a bundled Codex binary before PATH", async () => {
    await withTempDir(async (root) => {
      const binDir = join(root, "bin");
      await mkdir(binDir);
      const codex = join(binDir, process.platform === "win32" ? "codex.exe" : "codex");
      await writeExecutable(codex);

      await expect(
        resolveCodexBinary(createSystemCommands({ available: ["codex"] }), {
          OPENDUCKTOR_BUNDLED_BIN_DIR: binDir,
        }),
      ).resolves.toBe(codex);
    });
  });

  test("resolves Codex from Electron resources before PATH", async () => {
    await withTempDir(async (root) => {
      const binDir = join(root, "resources", "bin");
      await mkdir(binDir, { recursive: true });
      const codex = join(binDir, "codex.exe");
      await writeFile(codex, "");

      await expect(
        resolveCodexBinary(
          createSystemCommands({ available: ["codex"] }),
          {},
          { platform: "win32", resourcesPath: join(root, "resources") },
        ),
      ).resolves.toBe(codex);
    });
  });

  test("fails when an explicit Codex override is empty", async () => {
    await expect(
      resolveCodexBinary(createSystemCommands(), {
        OPENDUCKTOR_CODEX_BINARY: "",
      }),
    ).rejects.toThrow("Configured Codex override OPENDUCKTOR_CODEX_BINARY is empty");
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

  test("fails when the bundled bin directory env var is empty", async () => {
    await expect(
      resolveCodexBinary(createSystemCommands(), {
        OPENDUCKTOR_BUNDLED_BIN_DIR: " ",
      }),
    ).rejects.toThrow("Configured bundled binary directory OPENDUCKTOR_BUNDLED_BIN_DIR is empty");
  });

  test("uses PATH fallback after Codex override and bundled locations", async () => {
    await expect(
      resolveCodexBinary(createSystemCommands({ available: ["codex"] }), {}),
    ).resolves.toBe("codex");
  });

  test("returns the resolved Windows PATHEXT Codex path for PATH fallback", async () => {
    await withTempDir(async (root) => {
      const codex = join(root, "codex.bat");
      await writeFile(codex, "");
      const systemCommands = createSystemCommandRunner({
        env: { PATH: root, PATHEXT: ".bat" },
        platform: "win32",
      });

      await expect(
        resolveCodexBinary(systemCommands, { PATH: root, PATHEXT: ".bat" }, { platform: "win32" }),
      ).resolves.toBe(codex);
    });
  });

  test("reports considered Codex locations when missing", async () => {
    await expect(
      resolveCodexBinary(
        createSystemCommands(),
        {},
        { platform: "linux", resourcesPath: "/opt/OpenDucktor/resources" },
      ),
    ).rejects.toThrow(
      "codex not found. Checked OPENDUCKTOR_CODEX_BINARY, bundled locations (OPENDUCKTOR_BUNDLED_BIN_DIR, /opt/OpenDucktor/resources/bin/codex), and PATH. Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.",
    );
  });
});
