import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ResolvedTool, ToolDiscoveryId } from "../../ports/tool-discovery-port";
import { createSystemCommandRunner } from "./system-command-runner";
import { createToolDiscoveryAdapter, type ToolDiscoveryPathOptions } from "./tool-discovery";

const createSystemCommands = ({
  available = [],
}: {
  available?: string[];
} = {}): SystemCommandPort => ({
  resolveCommandPath(command, options) {
    if (options?.searchPath) {
      return Effect.succeed(null);
    }
    return Effect.succeed(available.includes(command) ? `/path/${command}` : null);
  },
  versionCommand() {
    return Effect.succeed(null);
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: false, stdout: "", stderr: "" });
  },
});

const withTempDir = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-tool-discovery-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const writeExecutable = async (path: string): Promise<void> => {
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, 0o755);
};

const builtInOverrideCases = [
  { command: "bun", toolId: "bun", variable: "OPENDUCKTOR_BUN_PATH" },
  { command: "claude", toolId: "claude", variable: "OPENDUCKTOR_CLAUDE_BINARY" },
  { command: "codex", toolId: "codex", variable: "OPENDUCKTOR_CODEX_BINARY" },
  { command: "git", toolId: "git", variable: "OPENDUCKTOR_GIT_PATH" },
  { command: "gh", toolId: "githubCli", variable: "OPENDUCKTOR_GH_PATH" },
  {
    command: "opencode",
    toolId: "opencode",
    variable: "OPENDUCKTOR_OPENCODE_BINARY",
  },
] as const satisfies readonly {
  command: string;
  toolId: ToolDiscoveryId;
  variable: string;
}[];

const discoverBuiltInTool = ({
  env = {},
  options = {},
  systemCommands = createSystemCommands(),
  toolId,
}: {
  env?: NodeJS.ProcessEnv;
  options?: ToolDiscoveryPathOptions;
  systemCommands?: SystemCommandPort;
  toolId: ToolDiscoveryId;
}) => {
  const adapter = createToolDiscoveryAdapter({ env, options, systemCommands });
  return Effect.runPromise(adapter.resolveToolPath(toolId));
};

const discoverBuiltInToolResult = ({
  env = {},
  options = {},
  systemCommands = createSystemCommands(),
  toolId,
}: {
  env?: NodeJS.ProcessEnv;
  options?: ToolDiscoveryPathOptions;
  systemCommands?: SystemCommandPort;
  toolId: ToolDiscoveryId;
}): Promise<ResolvedTool> => {
  const adapter = createToolDiscoveryAdapter({ env, options, systemCommands });
  return Effect.runPromise(adapter.resolveTool(toolId));
};

describe("discoverToolPath", () => {
  test("uses a descriptor environment override before bundled, standard, and PATH", async () => {
    await withTempDir(async (root) => {
      const override = join(root, "opencode");
      await writeExecutable(override);

      await expect(
        discoverBuiltInTool({
          env: { OPENDUCKTOR_OPENCODE_BINARY: override },
          options: {
            bundledToolBinDirs: { opencode: join(root, "bundled") },
            homeDir: root,
            platform: "linux",
          },
          systemCommands: createSystemCommandRunner({
            env: { PATH: "" },
            platform: "linux",
          }),
          toolId: "opencode",
        }),
      ).resolves.toBe(override);
    });
  });

  test("returns the validated command path for command-name environment overrides", async () => {
    await expect(
      discoverBuiltInTool({
        env: { OPENDUCKTOR_BUN_PATH: "bun" },
        systemCommands: createSystemCommands({ available: ["bun"] }),
        toolId: "bun",
      }),
    ).resolves.toBe("/path/bun");
  });

  test("rejects Windows environment overrides that are not runnable command files", async () => {
    await withTempDir(async (root) => {
      const override = join(root, "bun.txt");
      await writeFile(override, "");

      await expect(
        discoverBuiltInTool({
          env: { OPENDUCKTOR_BUN_PATH: override },
          options: { homeDir: root, platform: "win32" },
          systemCommands: createSystemCommandRunner({
            env: { PATH: "" },
            platform: "win32",
          }),
          toolId: "bun",
        }),
      ).rejects.toThrow("points to a missing or non-executable file");
    });
  });

  test("uses descriptor bundled and standard sources before PATH", async () => {
    await withTempDir(async (root) => {
      const bundledDir = join(root, "bundled");
      await mkdir(bundledDir);
      const bundled = join(bundledDir, "opencode");
      await writeExecutable(bundled);

      const bundledOptions = {
        bundledToolBinDirs: { opencode: bundledDir },
        homeDir: root,
        platform: "linux" as const,
      };
      await expect(
        discoverBuiltInTool({
          options: bundledOptions,
          systemCommands: createSystemCommandRunner({
            env: { PATH: "" },
            platform: "linux",
          }),
          toolId: "opencode",
        }),
      ).resolves.toBe(bundled);

      await rm(bundledDir, { force: true, recursive: true });
      const standardDir = join(root, ".opencode", "bin");
      await mkdir(standardDir, { recursive: true });
      const standard = join(standardDir, "opencode");
      await writeExecutable(standard);
      const standardOptions = {
        homeDir: root,
        platform: "linux" as const,
      };

      await expect(
        discoverBuiltInTool({
          options: standardOptions,
          systemCommands: createSystemCommandRunner({
            env: { PATH: "" },
            platform: "linux",
          }),
          toolId: "opencode",
        }),
      ).resolves.toBe(standard);

      await rm(standardDir, { force: true, recursive: true });
      await expect(
        discoverBuiltInTool({
          options: standardOptions,
          systemCommands: createSystemCommands({ available: ["opencode"] }),
          toolId: "opencode",
        }),
      ).resolves.toBe("/path/opencode");
    });
  });

  test("reports environment override, provided path, and PATH provenance distinctly", async () => {
    await withTempDir(async (root) => {
      const provided = join(root, "provided-bun");
      const override = join(root, "override-bun");
      await writeExecutable(provided);
      await writeExecutable(override);

      await expect(
        discoverBuiltInToolResult({
          env: { OPENDUCKTOR_BUN_PATH: override },
          options: {
            platform: "linux",
            providedToolPaths: { bun: provided },
          },
          systemCommands: createSystemCommandRunner({
            env: { PATH: "" },
            platform: "linux",
          }),
          toolId: "bun",
        }),
      ).resolves.toEqual({
        displayLabel: "Environment override",
        path: override,
        sourceCategory: "environment_override",
      });

      await expect(
        discoverBuiltInToolResult({
          options: {
            platform: "linux",
            providedToolPaths: { bun: provided },
          },
          systemCommands: createSystemCommandRunner({
            env: { PATH: "" },
            platform: "linux",
          }),
          toolId: "bun",
        }),
      ).resolves.toEqual({
        displayLabel: "Provided path",
        path: provided,
        sourceCategory: "provided_path",
      });

      await expect(
        discoverBuiltInToolResult({
          options: { platform: "linux" },
          systemCommands: createSystemCommands({ available: ["bun"] }),
          toolId: "bun",
        }),
      ).resolves.toEqual({
        displayLabel: "System PATH",
        path: "/path/bun",
        sourceCategory: "system_path",
      });
    });
  });

  test("reports all checked descriptor sources when a tool is missing", async () => {
    await withTempDir(async (root) => {
      const applicationsDir = join(root, "Applications");
      const homeDir = join(root, "home");

      await expect(
        discoverBuiltInTool({
          options: {
            applicationsDir,
            homeDir,
            platform: "darwin",
          },
          systemCommands: createSystemCommands(),
          toolId: "codex",
        }),
      ).rejects.toThrow(
        `codex not found. Checked OPENDUCKTOR_CODEX_BINARY, standard install locations (${applicationsDir}/Codex.app/Contents/Resources/codex, ${homeDir}/Applications/Codex.app/Contents/Resources/codex), PATH. Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.`,
      );
    });
  });

  test("fails at a required bundled source before PATH", async () => {
    await expect(
      discoverBuiltInTool({
        options: {
          bundledToolBinDirs: { opencode: "/opt/OpenDucktor/bin" },
          platform: "linux",
        },
        systemCommands: createSystemCommands({ available: ["opencode"] }),
        toolId: "opencode",
      }),
    ).rejects.toThrow(
      "opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY, bundled tool directory (/opt/OpenDucktor/bin). Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.",
    );
  });

  test("uses SystemCommandRunner PATHEXT resolution for bundled directories", async () => {
    await withTempDir(async (root) => {
      const bundledDir = join(root, "bundled");
      await mkdir(bundledDir);
      const bundled = join(bundledDir, "opencode.CMD");
      await writeFile(bundled, "");

      const systemCommands = createSystemCommandRunner({
        env: { PATHEXT: ".CMD;.BAT", PATH: "" },
        platform: "win32",
      });

      await expect(
        discoverBuiltInTool({
          options: {
            bundledToolBinDirs: { opencode: bundledDir },
            homeDir: root,
            platform: "win32",
          },
          systemCommands,
          toolId: "opencode",
        }),
      ).resolves.toBe(bundled);
    });
  });

  test("does not resolve executable POSIX directories from PATH", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "bun"));
      await chmod(join(root, "bun"), 0o755);

      await expect(
        discoverBuiltInTool({
          env: { PATH: root },
          options: { homeDir: root, platform: "linux" },
          systemCommands: createSystemCommandRunner({
            env: { PATH: root },
            platform: "linux",
          }),
          toolId: "bun",
        }),
      ).rejects.toThrow("bun not found");
    });
  });

  test("keeps artifact bundled tool directories scoped to their tool id", async () => {
    const adapter = createToolDiscoveryAdapter({
      env: {},
      options: {
        bundledToolBinDirs: { opencode: "/opt/OpenDucktor/bin" },
        platform: "linux",
      },
      systemCommands: createSystemCommands({ available: ["codex"] }),
    });

    await expect(Effect.runPromise(adapter.resolveToolPath("codex"))).resolves.toBe("/path/codex");
  });

  test("supports descriptor environment overrides for every built-in tool", async () => {
    await withTempDir(async (root) => {
      for (const overrideCase of builtInOverrideCases) {
        const executable = join(root, overrideCase.command);
        await writeExecutable(executable);
        const adapter = createToolDiscoveryAdapter({
          env: { [overrideCase.variable]: executable },
          options: { homeDir: root, platform: "linux" },
          systemCommands: createSystemCommandRunner({
            env: { PATH: "" },
            platform: "linux",
          }),
        });

        await expect(Effect.runPromise(adapter.resolveToolPath(overrideCase.toolId))).resolves.toBe(
          executable,
        );
      }
    });
  });

  test("uses provided tool paths after environment overrides and before PATH", async () => {
    await withTempDir(async (root) => {
      const provided = join(root, "provided-bun");
      await writeExecutable(provided);

      const adapter = createToolDiscoveryAdapter({
        env: {},
        options: {
          platform: "linux",
          providedToolPaths: { bun: provided },
        },
        systemCommands: createSystemCommandRunner({
          env: { PATH: "" },
          platform: "linux",
        }),
      });

      await expect(Effect.runPromise(adapter.resolveToolPath("bun"))).resolves.toBe(provided);
    });
  });

  test("keeps explicit environment overrides ahead of provided tool paths", async () => {
    await withTempDir(async (root) => {
      const provided = join(root, "provided-bun");
      const override = join(root, "override-bun");
      await writeExecutable(provided);
      await writeExecutable(override);

      const adapter = createToolDiscoveryAdapter({
        env: { OPENDUCKTOR_BUN_PATH: override },
        options: {
          platform: "linux",
          providedToolPaths: { bun: provided },
        },
        systemCommands: createSystemCommandRunner({
          env: { PATH: "" },
          platform: "linux",
        }),
      });

      await expect(Effect.runPromise(adapter.resolveToolPath("bun"))).resolves.toBe(override);
    });
  });

  test("rejects invalid provided tool paths before PATH", async () => {
    const adapter = createToolDiscoveryAdapter({
      env: {},
      options: {
        platform: "linux",
        providedToolPaths: { bun: "/missing/provided-bun" },
      },
      systemCommands: createSystemCommands({ available: ["bun"] }),
    });

    await expect(Effect.runPromise(adapter.resolveToolPath("bun"))).rejects.toThrow(
      "Provided bun path for bun points to a missing or non-executable file: /missing/provided-bun",
    );
  });

  test("reports descriptor override variables for PATH-resolved built-in tools", async () => {
    const adapter = createToolDiscoveryAdapter({
      env: {},
      options: { platform: "linux" },
      systemCommands: createSystemCommands(),
    });

    await expect(Effect.runPromise(adapter.resolveToolPath("bun"))).rejects.toThrow(
      "bun not found. Checked OPENDUCKTOR_BUN_PATH, PATH. Install bun and ensure it is available on PATH, or set OPENDUCKTOR_BUN_PATH.",
    );
  });

  test("deduplicates concurrent discovery and caches successful tool paths", async () => {
    let resolveCalls = 0;
    const systemCommands: SystemCommandPort = {
      resolveCommandPath(command) {
        resolveCalls += 1;
        return Effect.promise(
          () =>
            new Promise<string>((resolve) => {
              setTimeout(() => resolve(`/path/${command}`), 10);
            }),
        );
      },
      versionCommand() {
        return Effect.succeed(null);
      },
      runCommandAllowFailure() {
        return Effect.succeed({ ok: false, stdout: "", stderr: "" });
      },
    };
    const adapter = createToolDiscoveryAdapter({
      env: {},
      options: { platform: "linux" },
      systemCommands,
    });

    await expect(
      Effect.runPromise(
        Effect.all([adapter.resolveToolPath("bun"), adapter.resolveToolPath("bun")], {
          concurrency: "unbounded",
        }),
      ),
    ).resolves.toEqual(["/path/bun", "/path/bun"]);
    expect(resolveCalls).toBe(1);

    await expect(Effect.runPromise(adapter.resolveToolPath("bun"))).resolves.toBe("/path/bun");
    expect(resolveCalls).toBe(1);
  });
});
