import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  SystemCommandPort,
  SystemCommandRunOptions,
  SystemCommandRunResult,
} from "../../ports/system-command-port";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { createOpenInToolsAdapter } from "./open-in-tools-adapter";

type CommandLaunch = {
  args: string[];
  command: string;
  options?: SystemCommandRunOptions;
};

const createSystemCommands = ({
  resolvedCommands,
  runCommand,
  runOk = true,
  runStderr = "",
}: {
  resolvedCommands: Record<string, string | null>;
  runCommand?: (launch: CommandLaunch) => Effect.Effect<SystemCommandRunResult>;
  runOk?: boolean;
  runStderr?: string;
}) => {
  const launches: Array<{ args: string[]; command: string }> = [];
  const systemCommands: Pick<SystemCommandPort, "resolveCommandPath" | "runCommandAllowFailure"> = {
    resolveCommandPath(command) {
      return Effect.succeed(resolvedCommands[command] ?? null);
    },
    runCommandAllowFailure(command, args, options) {
      launches.push({ command, args });
      return (
        runCommand?.(options === undefined ? { command, args } : { command, args, options }) ??
        Effect.succeed({ ok: runOk, stdout: "", stderr: runStderr })
      );
    },
  };

  return { launches, systemCommands };
};

const withTempDir = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-open-in-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

describe("createOpenInToolsAdapter", () => {
  test("discovers installed macOS applications with bounded application icons", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {},
      runCommand: ({ args, command }) =>
        Effect.gen(function* () {
          if (command === "mdfind" && args[1] === "Ghostty.app") {
            return { ok: true, stdout: "/Applications/Ghostty.app\n", stderr: "" };
          }
          if (
            command === "defaults" &&
            args[1] === "/Applications/Finder.app/Contents/Info.plist"
          ) {
            return { ok: true, stdout: "FinderIcon\n", stderr: "" };
          }
          if (command === "iconutil") {
            const outputDirectory = args.at(-1);
            if (!outputDirectory) {
              return { ok: false, stdout: "", stderr: "missing iconutil output directory" };
            }
            yield* Effect.promise(() => mkdir(outputDirectory, { recursive: true }));
            yield* Effect.promise(() => writeFile(`${outputDirectory}/icon_16x16.png`, "small"));
            yield* Effect.promise(() =>
              writeFile(`${outputDirectory}/icon_128x128@2x.png`, "best"),
            );
            yield* Effect.promise(() =>
              writeFile(`${outputDirectory}/icon_512x512@2x.png`, "too-large"),
            );
          }
          return { ok: true, stdout: "", stderr: "" };
        }),
    });
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      systemCommands,
      homeDirectory: () => "/Users/dev",
      pathExists: (inputPath) =>
        Effect.succeed(
          inputPath === "/Applications/Finder.app" ||
            inputPath === "/Applications/Finder.app/Contents/Info.plist" ||
            inputPath === "/Applications/Finder.app/Contents/Resources/FinderIcon.icns" ||
            inputPath === "/Applications/Ghostty.app",
        ),
      pathIsDirectory: (inputPath) => Effect.succeed(inputPath.endsWith(".app")),
    });
    await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toEqual([
      {
        toolId: "finder",
        iconDataUrl: `data:image/png;base64,${Buffer.from("best").toString("base64")}`,
      },
      { toolId: "ghostty", iconDataUrl: null },
    ]);
    expect(launches.some((launch) => launch.command === "sips")).toBe(false);
  });
  test("propagates Spotlight lookup failures", async () => {
    const { systemCommands } = createSystemCommands({
      resolvedCommands: {},
      runCommand: ({ command }) => {
        if (command === "mdfind") {
          return Effect.succeed({ ok: false, stdout: "", stderr: "Spotlight unavailable" });
        }
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      },
    });
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      systemCommands,
      homeDirectory: () => "/Users/dev",
      pathExists: (inputPath) => Effect.succeed(inputPath === "/Applications/Finder.app"),
      pathIsDirectory: (inputPath) => Effect.succeed(inputPath.endsWith(".app")),
    });
    const result = await Effect.runPromise(Effect.either(port.discoverOpenInTools()));

    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") {
      return;
    }
    expect(result.left).toBeInstanceOf(HostOperationError);
    expect(result.left).toHaveProperty("operation", "openInTools.runCommand");
    expect(result.left.message).toContain("Command mdfind exited unsuccessfully");
    expect(result.left.details).toMatchObject({
      args: ["-name", expect.stringMatching(/\.app$/)],
      program: "mdfind",
      stderr: "Spotlight unavailable",
    });
  });
  test("checks every direct application alias before requiring Spotlight", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {},
      runCommand: ({ command }) =>
        Effect.succeed({
          ok: command !== "mdfind",
          stdout: "",
          stderr: command === "mdfind" ? "Spotlight unavailable" : "",
        }),
    });
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      systemCommands,
      homeDirectory: () => "/Users/dev",
      pathExists: (inputPath) => Effect.succeed(inputPath === "/Applications/PyCharm CE.app"),
      pathIsDirectory: () => Effect.succeed(true),
      realpathFn: (inputPath) => Effect.succeed(inputPath),
    });

    await Effect.runPromise(port.openDirectoryInTool("/repo", "pycharm"));

    expect(launches).toEqual([
      {
        command: "open",
        args: ["-na", "/Applications/PyCharm CE.app", "--args", "/repo"],
      },
    ]);
  });
  test("treats successful empty Spotlight output as an application-not-found result", async () => {
    const { launches, systemCommands } = createSystemCommands({ resolvedCommands: {} });
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      systemCommands,
      homeDirectory: () => "/Users/dev",
      pathExists: () => Effect.succeed(false),
      pathIsDirectory: () => Effect.succeed(false),
    });

    await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toEqual([]);
    expect(launches.some((launch) => launch.command === "mdfind")).toBe(true);
  });
  test("launches a directory with the selected app", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {},
      runCommand: ({ args, command }) => {
        if (command === "mdfind" && args[1] === "Visual Studio Code.app") {
          return Effect.succeed({
            ok: true,
            stdout: "/Applications/Visual Studio Code.app\n",
            stderr: "",
          });
        }
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      },
    });
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      systemCommands,
      homeDirectory: () => "/Users/dev",
      pathExists: (inputPath) =>
        Effect.succeed(inputPath === "/Applications/Visual Studio Code.app"),
      pathIsDirectory: () => Effect.succeed(true),
      realpathFn: (inputPath) => Effect.succeed(inputPath),
    });
    await Effect.runPromise(port.openDirectoryInTool("/repo", "vscode"));
    expect(launches.at(-1)).toEqual({
      command: "open",
      args: ["-a", "/Applications/Visual Studio Code.app", "/repo"],
    });
  });
  test("rejects macOS contract-valid but unsupported selected tools as validation errors", async () => {
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      pathExists: () => Effect.succeed(false),
      pathIsDirectory: () => Effect.succeed(false),
    });

    const result = await Effect.runPromise(
      Effect.either(port.openDirectoryInTool("/repo", "explorer")),
    );

    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") {
      return;
    }
    expect(result.left).toBeInstanceOf(HostValidationError);
    expect(result.left).toHaveProperty("message", "Unsupported Open In tool: explorer");
  });
  test("opens external URLs with the platform browser command", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: { open: "/usr/bin/open" },
    });
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      systemCommands,
    });
    await Effect.runPromise(port.openExternalUrl("https://example.com"));
    expect(launches).toEqual([{ command: "open", args: ["https://example.com"] }]);
  });
  test("opens Windows external URLs without routing them through cmd", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {},
    });
    const port = createOpenInToolsAdapter({
      platform: "win32",
      processEnv: { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
      systemCommands,
    });

    await Effect.runPromise(port.openExternalUrl("https://example.com"));

    expect(launches).toEqual([
      {
        command: "explorer.exe",
        args: ["https://example.com"],
      },
    ]);
  });
  test("rejects external URL opening on unsupported platforms", async () => {
    const port = createOpenInToolsAdapter({ platform: "aix" });
    await expect(Effect.runPromise(port.openExternalUrl("https://example.com"))).rejects.toThrow(
      "Opening external URLs is not supported on aix.",
    );
  });
  test("discovers Linux tools from command resolution", async () => {
    const { systemCommands } = createSystemCommands({
      resolvedCommands: {
        "xdg-open": "/usr/bin/xdg-open",
        "x-terminal-emulator": "/usr/bin/x-terminal-emulator",
        code: "/usr/bin/code",
        cursor: null,
      },
    });
    const port = createOpenInToolsAdapter({ platform: "linux", systemCommands });

    await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toEqual([
      { toolId: "xdg-open", iconDataUrl: null },
      { toolId: "terminal", iconDataUrl: null },
      { toolId: "vscode", iconDataUrl: null },
    ]);
  });

  test("returns an empty Linux discovery result when supported commands are missing", async () => {
    const { systemCommands } = createSystemCommands({ resolvedCommands: {} });
    const port = createOpenInToolsAdapter({ platform: "linux", systemCommands });

    await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toEqual([]);
  });

  test("launches Linux selected tools with paths containing spaces", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: { "xdg-open": "/usr/bin/xdg-open" },
    });
    const port = createOpenInToolsAdapter({ platform: "linux", systemCommands });

    await Effect.runPromise(port.openDirectoryInTool("/tmp/repo with spaces", "xdg-open"));

    expect(launches).toEqual([{ command: "/usr/bin/xdg-open", args: ["/tmp/repo with spaces"] }]);
  });

  test("launches x-terminal-emulator with working-directory arguments", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {
        "x-terminal-emulator": "/usr/bin/x-terminal-emulator",
      },
    });
    const port = createOpenInToolsAdapter({ platform: "linux", systemCommands });

    await Effect.runPromise(port.openDirectoryInTool("/tmp/repo with spaces", "terminal"));

    expect(launches).toEqual([
      {
        command: "/usr/bin/x-terminal-emulator",
        args: ["--working-directory=/tmp/repo with spaces"],
      },
    ]);
  });

  test("launches Linux terminals with command-specific directory arguments", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {
        "x-terminal-emulator": null,
        "gnome-terminal": null,
        konsole: "/usr/bin/konsole",
      },
    });
    const port = createOpenInToolsAdapter({ platform: "linux", systemCommands });

    await Effect.runPromise(port.openDirectoryInTool("/tmp/repo with spaces", "terminal"));

    expect(launches).toEqual([
      { command: "/usr/bin/konsole", args: ["--workdir", "/tmp/repo with spaces"] },
    ]);
  });

  test("discovers and launches Windows tools through command resolution", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {
        "explorer.exe": String.raw`C:\Windows\explorer.exe`,
        "wt.exe": String.raw`C:\Users\dev\AppData\Local\Microsoft\WindowsApps\wt.exe`,
        code: String.raw`C:\Users\dev\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd`,
      },
    });
    const port = createOpenInToolsAdapter({ platform: "win32", systemCommands });

    await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toEqual([
      { toolId: "explorer", iconDataUrl: null },
      { toolId: "terminal", iconDataUrl: null },
      { toolId: "vscode", iconDataUrl: null },
    ]);
    await Effect.runPromise(port.openDirectoryInTool(String.raw`C:\repo with spaces`, "terminal"));

    expect(launches).toEqual([
      {
        command: String.raw`C:\Users\dev\AppData\Local\Microsoft\WindowsApps\wt.exe`,
        args: ["-d", String.raw`C:\repo with spaces`],
      },
    ]);
  });

  test("treats File Explorer non-zero exit as a successful delegated launch", async () => {
    const { launches, systemCommands } = createSystemCommands({
      resolvedCommands: {
        "explorer.exe": String.raw`C:\Windows\explorer.exe`,
      },
      runOk: false,
      runStderr: "",
    });
    const port = createOpenInToolsAdapter({ platform: "win32", systemCommands });

    await Effect.runPromise(port.openDirectoryInTool(String.raw`C:\repo with spaces`, "explorer"));

    expect(launches).toEqual([
      {
        command: String.raw`C:\Windows\explorer.exe`,
        args: [String.raw`C:\repo with spaces`],
      },
    ]);
  });

  test("discovers and launches Windows command-script tools through the real command runner", async () => {
    if (process.platform !== "win32") {
      return;
    }

    await withTempDir(async (root) => {
      const toolDirectory = join(root, "tool dir");
      const targetDirectory = join(root, "repo with spaces");
      const markerPath = join(root, "opened.txt");
      await mkdir(toolDirectory);
      await mkdir(targetDirectory);
      await writeFile(
        join(toolDirectory, "code.CMD"),
        "@echo off\r\necho %~1>%ODT_OPEN_IN_MARKER%\r\n",
      );
      const systemCommands = createSystemCommandRunner({
        platform: "win32",
        env: {
          PATH: toolDirectory,
          PATHEXT: ".CMD",
          ODT_OPEN_IN_MARKER: markerPath,
          ComSpec: process.env.ComSpec,
        },
      });
      const port = createOpenInToolsAdapter({ platform: "win32", systemCommands });

      await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toContainEqual({
        toolId: "vscode",
        iconDataUrl: null,
      });
      await Effect.runPromise(port.openDirectoryInTool(targetDirectory, "vscode"));

      await expect(readFile(markerPath, "utf8")).resolves.toBe(`${targetDirectory}\r\n`);
    });
  });

  test("rejects selected command tools that disappear before launch", async () => {
    const { systemCommands } = createSystemCommands({
      resolvedCommands: { code: null },
    });
    const port = createOpenInToolsAdapter({ platform: "linux", systemCommands });

    await expect(Effect.runPromise(port.openDirectoryInTool("/repo", "vscode"))).rejects.toThrow(
      "VS Code is not installed or is no longer discoverable on linux.",
    );
  });

  test("rejects failed command tool launches with selected command details", async () => {
    const { systemCommands } = createSystemCommands({
      resolvedCommands: { code: "/usr/bin/code" },
      runOk: false,
      runStderr: "permission denied",
    });
    const port = createOpenInToolsAdapter({ platform: "linux", systemCommands });

    await expect(Effect.runPromise(port.openDirectoryInTool("/repo", "vscode"))).rejects.toThrow(
      "Command code exited unsuccessfully",
    );
  });

  test("rejects open-in discovery on unsupported platforms", async () => {
    const port = createOpenInToolsAdapter({ platform: "aix" });
    await expect(Effect.runPromise(port.discoverOpenInTools())).rejects.toThrow(
      "Open In tool discovery is not supported on aix.",
    );
  });
});
