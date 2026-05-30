import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { discoverToolPath, isExecutableFile, type ToolDiscoveryDescriptor } from "./tool-discovery";

const createSystemCommands = ({
  available = [],
}: {
  available?: string[];
} = {}): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(available.includes(command) ? `/path/${command}` : null);
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

const customToolDescriptor: ToolDiscoveryDescriptor = {
  command: "custom-tool",
  displayName: "Custom Tool",
  installHint: "Install custom-tool.",
  sources: [
    { kind: "environment", variable: "OPENDUCKTOR_CUSTOM_TOOL_BINARY" },
    { kind: "bundledToolBin", policy: "candidate" },
    {
      candidates: (context) => [join(context.homeDir, ".custom-tool", "bin", "custom-tool")],
      kind: "standardLocations",
      label: "standard install locations",
    },
    { kind: "path" },
  ],
};
const requiredBundledToolDescriptor: ToolDiscoveryDescriptor = {
  command: "required-tool",
  displayName: "Required Tool",
  installHint: "Install required-tool.",
  sources: [{ kind: "bundledToolBin", policy: "required" }, { kind: "path" }],
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

const testIfUnixModeIsAvailable = process.platform === "win32" ? test.skip : test;

describe("isExecutableFile", () => {
  test("rejects missing paths", async () => {
    await withTempDir(async (root) => {
      await expect(
        Effect.runPromise(isExecutableFile(join(root, "missing"), "linux")),
      ).resolves.toBe(false);
    });
  });

  test("rejects executable directories on POSIX platforms", async () => {
    await withTempDir(async (root) => {
      const directory = join(root, "bin");
      await mkdir(directory);
      await chmod(directory, 0o755);

      await expect(Effect.runPromise(isExecutableFile(directory, "linux"))).resolves.toBe(false);
    });
  });

  testIfUnixModeIsAvailable("rejects non-executable regular files on POSIX platforms", async () => {
    await withTempDir(async (root) => {
      const binary = join(root, "openducktor");
      await writeFile(binary, "");
      await chmod(binary, 0o644);

      await expect(Effect.runPromise(isExecutableFile(binary, "linux"))).resolves.toBe(false);
    });
  });

  test("accepts regular files on Windows without POSIX execute bits", async () => {
    await withTempDir(async (root) => {
      const binary = join(root, "openducktor.exe");
      await writeFile(binary, "");
      await chmod(binary, 0o644);

      await expect(Effect.runPromise(isExecutableFile(binary, "win32"))).resolves.toBe(true);
    });
  });
});

describe("discoverToolPath", () => {
  test("uses a descriptor environment override before bundled, standard, and PATH", async () => {
    await withTempDir(async (root) => {
      const override = join(root, "custom-tool");
      await writeExecutable(override);

      await expect(
        discoverCustomTool({
          env: { OPENDUCKTOR_CUSTOM_TOOL_BINARY: override },
          options: { bundledToolBinDir: join(root, "bundled"), homeDir: root, platform: "linux" },
        }),
      ).resolves.toBe(override);
    });
  });

  test("uses descriptor bundled and standard sources before PATH", async () => {
    await withTempDir(async (root) => {
      const bundledDir = join(root, "bundled");
      await mkdir(bundledDir);
      const bundled = join(bundledDir, "custom-tool");
      await writeExecutable(bundled);

      const options = { bundledToolBinDir: bundledDir, homeDir: root, platform: "linux" as const };
      await expect(discoverCustomTool({ options })).resolves.toBe(bundled);

      await rm(bundledDir, { force: true, recursive: true });
      const standardDir = join(root, ".custom-tool", "bin");
      await mkdir(standardDir, { recursive: true });
      const standard = join(standardDir, "custom-tool");
      await writeExecutable(standard);

      await expect(discoverCustomTool({ options })).resolves.toBe(standard);

      await rm(standardDir, { force: true, recursive: true });
      await expect(discoverCustomTool({ options })).resolves.toBe("/path/custom-tool");
    });
  });

  test("reports all checked descriptor sources when a tool is missing", async () => {
    await expect(
      discoverCustomTool({
        options: {
          bundledToolBinDir: "/opt/OpenDucktor/bin",
          homeDir: "/home/alice",
          platform: "linux",
        },
        systemCommands: createSystemCommands(),
      }),
    ).rejects.toThrow(
      "custom-tool not found. Checked OPENDUCKTOR_CUSTOM_TOOL_BINARY, bundled tool location (/opt/OpenDucktor/bin/custom-tool), standard install locations (/home/alice/.custom-tool/bin/custom-tool), PATH. Install custom-tool.",
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
            bundledToolBinDir: "/opt/OpenDucktor/bin",
            platform: "linux",
          },
        ),
      ),
    ).rejects.toThrow(
      "required-tool not found. Checked bundled tool location (/opt/OpenDucktor/bin/required-tool). Install required-tool.",
    );
  });
});
