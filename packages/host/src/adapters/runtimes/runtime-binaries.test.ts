import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { isExecutableFile, resolveCodexBinary, resolveOpencodeBinary } from "./runtime-binaries";
import {
  createArtifactRuntimeDistribution,
  createSourceRuntimeDistribution,
} from "./runtime-distribution";

const createSystemCommands = ({
  available = [],
}: {
  available?: string[];
} = {}): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(available.includes(command) ? command : null);
  },
  requiredCommandError(command) {
    return Effect.succeed(
      available.includes(command) ? null : `Required command \`${command}\` not found.`,
    );
  },
  versionCommand() {
    return Effect.succeed(null);
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: false, stdout: "", stderr: "" });
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
const testRuntimeDistribution = createSourceRuntimeDistribution("/test/openducktor");

describe("isExecutableFile", () => {
  test("rejects executable directories on POSIX platforms", async () => {
    await withTempDir(async (root) => {
      const directory = join(root, "bin");
      await mkdir(directory);
      await chmod(directory, 0o755);

      await expect(Effect.runPromise(isExecutableFile(directory, "linux"))).resolves.toBe(false);
    });
  });
});

describe("resolveOpencodeBinary", () => {
  test("resolves an explicit OpenCode override", async () => {
    await withTempDir(async (root) => {
      const opencode = join(root, "opencode");
      await writeExecutable(opencode);

      await expect(
        Effect.runPromise(
          resolveOpencodeBinary(createSystemCommands(), {
            OPENDUCKTOR_OPENCODE_BINARY: opencode,
          }),
        ),
      ).resolves.toBe(opencode);
    });
  });

  test("fails when an explicit OpenCode override is empty", async () => {
    await expect(
      Effect.runPromise(
        resolveOpencodeBinary(createSystemCommands(), {
          OPENDUCKTOR_OPENCODE_BINARY: " ",
        }),
      ),
    ).rejects.toThrow("Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY is empty");
  });

  test("fails when an explicit OpenCode override is not runnable", async () => {
    await expect(
      Effect.runPromise(
        resolveOpencodeBinary(createSystemCommands(), {
          OPENDUCKTOR_OPENCODE_BINARY: "/missing/opencode",
        }),
      ),
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
        Effect.runPromise(
          resolveOpencodeBinary(
            createSystemCommands(),
            {
              OPENDUCKTOR_OPENCODE_BINARY: `"~/bin/opencode"`,
            },
            { homeDir: root },
          ),
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
      const expectedResolvedPath = posix.join(root, ".opencode", "bin", "opencode");

      await expect(
        Effect.runPromise(
          resolveOpencodeBinary(
            createSystemCommands({ available: ["opencode"] }),
            {},
            { homeDir: root, platform: "linux" },
          ),
        ),
      ).resolves.toBe(expectedResolvedPath);
    });
  });

  test("resolves the Windows standard OpenCode install path", async () => {
    await withTempDir(async (root) => {
      const binDir = join(root, ".opencode", "bin");
      await mkdir(binDir, { recursive: true });
      const opencode = join(binDir, "opencode.exe");
      await writeFile(opencode, "");

      await expect(
        Effect.runPromise(
          resolveOpencodeBinary(createSystemCommands(), {}, { homeDir: root, platform: "win32" }),
        ),
      ).resolves.toBe(opencode);
    });
  });

  test("uses PATH fallback after OpenCode override and standard locations", async () => {
    await expect(
      Effect.runPromise(
        resolveOpencodeBinary(createSystemCommands({ available: ["opencode"] }), {}),
      ),
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
        Effect.runPromise(
          resolveOpencodeBinary(
            systemCommands,
            { PATH: root, PATHEXT: ".cmd" },
            { platform: "win32" },
          ),
        ),
      ).resolves.toBe(opencode);
    });
  });

  test("reports considered OpenCode locations when missing", async () => {
    await expect(
      Effect.runPromise(
        resolveOpencodeBinary(
          createSystemCommands(),
          {},
          { homeDir: "/home/alice", platform: "linux" },
        ),
      ),
    ).rejects.toThrow(
      "opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY, standard install location /home/alice/.opencode/bin/opencode, and PATH. Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.",
    );
  });
});

describe("resolveCodexBinary", () => {
  test("uses an explicit Codex override before distribution bundled binaries and PATH", async () => {
    await withTempDir(async (root) => {
      const override = join(root, "codex");
      await writeExecutable(override);
      const binDir = join(root, "bin");
      await mkdir(binDir);
      await writeExecutable(join(binDir, "codex"));

      await expect(
        Effect.runPromise(
          resolveCodexBinary(
            createSystemCommands({ available: ["codex"] }),
            {
              OPENDUCKTOR_CODEX_BINARY: override,
            },
            {
              runtimeDistribution: createArtifactRuntimeDistribution({
                bundledBinDir: binDir,
                mcpLauncher: {
                  kind: "executable",
                  executablePath: override,
                },
              }),
            },
          ),
        ),
      ).resolves.toBe(override);
    });
  });

  test("resolves a distribution bundled Codex binary before PATH", async () => {
    await withTempDir(async (root) => {
      const binDir = join(root, "bin");
      await mkdir(binDir);
      const codex = join(binDir, process.platform === "win32" ? "codex.exe" : "codex");
      await writeExecutable(codex);

      await expect(
        Effect.runPromise(
          resolveCodexBinary(
            createSystemCommands({ available: ["codex"] }),
            {},
            {
              runtimeDistribution: createArtifactRuntimeDistribution({
                bundledBinDir: binDir,
                mcpLauncher: {
                  kind: "executable",
                  executablePath: codex,
                },
              }),
            },
          ),
        ),
      ).resolves.toBe(codex);
    });
  });

  test("fails when an explicit Codex override is empty", async () => {
    await expect(
      Effect.runPromise(
        resolveCodexBinary(
          createSystemCommands(),
          {
            OPENDUCKTOR_CODEX_BINARY: "",
          },
          { runtimeDistribution: testRuntimeDistribution },
        ),
      ),
    ).rejects.toThrow("Configured Codex override OPENDUCKTOR_CODEX_BINARY is empty");
  });

  test("fails when an explicit Codex override is not executable", async () => {
    await expect(
      Effect.runPromise(
        resolveCodexBinary(
          createSystemCommands(),
          {
            OPENDUCKTOR_CODEX_BINARY: "/missing/codex",
          },
          { runtimeDistribution: testRuntimeDistribution },
        ),
      ),
    ).rejects.toThrow(
      "Configured Codex override OPENDUCKTOR_CODEX_BINARY points to a missing or non-executable file: /missing/codex",
    );
  });

  test("uses PATH fallback after Codex override and bundled locations", async () => {
    await expect(
      Effect.runPromise(
        resolveCodexBinary(
          createSystemCommands({ available: ["codex"] }),
          {},
          {
            runtimeDistribution: testRuntimeDistribution,
          },
        ),
      ),
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
        Effect.runPromise(
          resolveCodexBinary(
            systemCommands,
            { PATH: root, PATHEXT: ".bat" },
            { platform: "win32", runtimeDistribution: testRuntimeDistribution },
          ),
        ),
      ).resolves.toBe(codex);
    });
  });

  test("reports considered Codex locations when missing", async () => {
    await expect(
      Effect.runPromise(
        resolveCodexBinary(
          createSystemCommands(),
          {},
          {
            platform: "linux",
            runtimeDistribution: createArtifactRuntimeDistribution({
              bundledBinDir: "/opt/OpenDucktor/resources/bin",
              mcpLauncher: {
                kind: "executable",
                executablePath: "/opt/OpenDucktor/resources/bin/openducktor-mcp",
              },
            }),
          },
        ),
      ),
    ).rejects.toThrow(
      "codex not found. Checked OPENDUCKTOR_CODEX_BINARY, bundled location (/opt/OpenDucktor/resources/bin/codex), and PATH. Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.",
    );
  });
});
