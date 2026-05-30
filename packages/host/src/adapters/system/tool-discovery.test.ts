import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryId } from "../../ports/tool-discovery-port";
import { createSystemCommandRunner } from "./system-command-runner";
import {
  createToolDiscoveryAdapter,
  discoverToolPath,
  type ToolDiscoveryDescriptor,
} from "./tool-discovery";

const joinPlatformPath = (platform: NodeJS.Platform, ...segments: string[]): string =>
  platform === "win32" ? win32.join(...segments) : posix.join(...segments);

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
  { command: "bd", toolId: "beads", variable: "OPENDUCKTOR_BD_PATH" },
  { command: "bun", toolId: "bun", variable: "OPENDUCKTOR_BUN_PATH" },
  { command: "codex", toolId: "codex", variable: "OPENDUCKTOR_CODEX_BINARY" },
  { command: "dolt", toolId: "dolt", variable: "OPENDUCKTOR_DOLT_PATH" },
  { command: "git", toolId: "git", variable: "OPENDUCKTOR_GIT_PATH" },
  { command: "gh", toolId: "githubCli", variable: "OPENDUCKTOR_GH_PATH" },
  { command: "opencode", toolId: "opencode", variable: "OPENDUCKTOR_OPENCODE_BINARY" },
] as const satisfies readonly {
  command: string;
  toolId: ToolDiscoveryId;
  variable: string;
}[];

const customToolDescriptor: ToolDiscoveryDescriptor = {
  command: "custom-tool",
  displayName: "Custom Tool",
  installHint: "Install custom-tool.",
  sources: [
    { kind: "environment", variable: "OPENDUCKTOR_CUSTOM_TOOL_BINARY" },
    {
      directories: (context) => [context.bundledToolBinDirs.opencode],
      kind: "searchDirectories",
      label: "bundled tool directory",
      policy: "candidate",
    },
    {
      directories: (context) => [
        joinPlatformPath(context.platform, context.homeDir, ".custom-tool", "bin"),
      ],
      kind: "searchDirectories",
      label: "standard install directories",
      policy: "candidate",
    },
    { kind: "path" },
  ],
};
const requiredBundledToolDescriptor: ToolDiscoveryDescriptor = {
  command: "required-tool",
  displayName: "Required Tool",
  installHint: "Install required-tool.",
  sources: [
    {
      directories: (context) => [context.bundledToolBinDirs.opencode],
      kind: "searchDirectories",
      label: "bundled tool directory",
      policy: "required",
    },
    { kind: "path" },
  ],
};
const discoverCustomTool = ({
  env = {},
  options = {},
  systemCommands = createSystemCommands({ available: ["custom-tool"] }),
}: {
  env?: NodeJS.ProcessEnv;
  options?: Parameters<typeof discoverToolPath>[3];
  systemCommands?: SystemCommandPort;
} = {}) => Effect.runPromise(discoverToolPath(customToolDescriptor, systemCommands, env, options));

describe("discoverToolPath", () => {
  test("uses a descriptor environment override before bundled, standard, and PATH", async () => {
    await withTempDir(async (root) => {
      const override = join(root, "custom-tool");
      await writeExecutable(override);

      await expect(
        discoverCustomTool({
          env: { OPENDUCKTOR_CUSTOM_TOOL_BINARY: override },
          options: {
            bundledToolBinDirs: { opencode: join(root, "bundled") },
            homeDir: root,
            platform: "linux",
          },
          systemCommands: createSystemCommandRunner({ env: { PATH: "" }, platform: "linux" }),
        }),
      ).resolves.toBe(override);
    });
  });

  test("returns the validated command path for command-name environment overrides", async () => {
    await expect(
      discoverCustomTool({
        env: { OPENDUCKTOR_CUSTOM_TOOL_BINARY: "custom-tool" },
        systemCommands: createSystemCommands({ available: ["custom-tool"] }),
      }),
    ).resolves.toBe("/path/custom-tool");
  });

  test("rejects Windows environment overrides that are not runnable command files", async () => {
    await withTempDir(async (root) => {
      const override = join(root, "custom-tool.txt");
      await writeFile(override, "");

      await expect(
        discoverCustomTool({
          env: { OPENDUCKTOR_CUSTOM_TOOL_BINARY: override },
          options: { homeDir: root, platform: "win32" },
          systemCommands: createSystemCommandRunner({ env: { PATH: "" }, platform: "win32" }),
        }),
      ).rejects.toThrow("points to a missing or non-executable file");
    });
  });

  test("uses descriptor bundled and standard sources before PATH", async () => {
    await withTempDir(async (root) => {
      const bundledDir = join(root, "bundled");
      await mkdir(bundledDir);
      const bundled = join(bundledDir, "custom-tool");
      await writeExecutable(bundled);

      const options = {
        bundledToolBinDirs: { opencode: bundledDir },
        homeDir: root,
        platform: "linux" as const,
      };
      await expect(
        discoverCustomTool({
          options,
          systemCommands: createSystemCommandRunner({ env: { PATH: "" }, platform: "linux" }),
        }),
      ).resolves.toBe(bundled);

      await rm(bundledDir, { force: true, recursive: true });
      const standardDir = join(root, ".custom-tool", "bin");
      await mkdir(standardDir, { recursive: true });
      const standard = join(standardDir, "custom-tool");
      await writeExecutable(standard);

      await expect(
        discoverCustomTool({
          options,
          systemCommands: createSystemCommandRunner({ env: { PATH: "" }, platform: "linux" }),
        }),
      ).resolves.toBe(standard);

      await rm(standardDir, { force: true, recursive: true });
      await expect(discoverCustomTool({ options })).resolves.toBe("/path/custom-tool");
    });
  });

  test("reports all checked descriptor sources when a tool is missing", async () => {
    await expect(
      discoverCustomTool({
        options: {
          bundledToolBinDirs: { opencode: "/opt/OpenDucktor/bin" },
          homeDir: "/home/alice",
          platform: "linux",
        },
        systemCommands: createSystemCommands(),
      }),
    ).rejects.toThrow(
      "custom-tool not found. Checked OPENDUCKTOR_CUSTOM_TOOL_BINARY, bundled tool directory (/opt/OpenDucktor/bin), standard install directories (/home/alice/.custom-tool/bin), PATH. Install custom-tool.",
    );
  });

  test("fails at a required bundled source before PATH", async () => {
    await expect(
      Effect.runPromise(
        discoverToolPath(
          requiredBundledToolDescriptor,
          createSystemCommands({ available: ["required-tool"] }),
          {},
          {
            bundledToolBinDirs: { opencode: "/opt/OpenDucktor/bin" },
            platform: "linux",
          },
        ),
      ),
    ).rejects.toThrow(
      "required-tool not found. Checked bundled tool directory (/opt/OpenDucktor/bin). Install required-tool.",
    );
  });

  test("uses SystemCommandRunner PATHEXT resolution for bundled and standard directories", async () => {
    await withTempDir(async (root) => {
      const bundledDir = join(root, "bundled");
      await mkdir(bundledDir);
      const bundled = join(bundledDir, "custom-tool.CMD");
      await writeFile(bundled, "");

      const systemCommands = createSystemCommandRunner({
        env: { PATHEXT: ".CMD;.BAT", PATH: "" },
        platform: "win32",
      });

      await expect(
        discoverCustomTool({
          options: {
            bundledToolBinDirs: { opencode: bundledDir },
            homeDir: root,
            platform: "win32",
          },
          systemCommands,
        }),
      ).resolves.toBe(bundled);

      await rm(bundledDir, { force: true, recursive: true });
      const standardDir = join(root, "standard");
      await mkdir(standardDir, { recursive: true });
      const standard = join(standardDir, "custom-tool.BAT");
      await writeFile(standard, "");

      await expect(
        Effect.runPromise(
          discoverToolPath(
            {
              command: "custom-tool",
              displayName: "Custom Tool",
              installHint: "Install custom-tool.",
              sources: [
                {
                  directories: () => [standardDir],
                  kind: "searchDirectories",
                  label: "standard install directories",
                  policy: "candidate",
                },
              ],
            },
            systemCommands,
            {},
            { platform: "win32" },
          ),
        ),
      ).resolves.toBe(standard);
    });
  });

  test("does not resolve executable POSIX directories from PATH", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "custom-tool"));
      await chmod(join(root, "custom-tool"), 0o755);

      await expect(
        discoverCustomTool({
          env: { PATH: root },
          options: { homeDir: root, platform: "linux" },
          systemCommands: createSystemCommandRunner({
            env: { PATH: root },
            platform: "linux",
          }),
        }),
      ).rejects.toThrow("custom-tool not found");
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
          systemCommands: createSystemCommandRunner({ env: { PATH: "" }, platform: "linux" }),
        });

        await expect(Effect.runPromise(adapter.resolveToolPath(overrideCase.toolId))).resolves.toBe(
          executable,
        );
      }
    });
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
});
