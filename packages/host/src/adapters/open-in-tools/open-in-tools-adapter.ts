import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  type HostPathAccessError,
  type HostPathNotFoundError,
  HostValidationError,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import type { OpenInToolsPort } from "../../ports/open-in-tools-port";
import { resolveMacOsAppIconDataUrl } from "./macos-open-in-icons";

const execFileAsync = promisify(execFile);

type OpenInLaunchStrategy = "open-directory" | "editor" | "jetbrains";

type OpenInToolMetadata = {
  id: SystemOpenInToolId;
  label: string;
  appNames: string[];
  launchStrategy: OpenInLaunchStrategy;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type OpenInCommandRunner = (
  program: string,
  args: string[],
  options?: { cwd?: string },
) => Effect.Effect<CommandResult, unknown>;

export type CreateOpenInToolsAdapterInput = {
  platform?: NodeJS.Platform;
  runner?: OpenInCommandRunner;
  pathExists?: (inputPath: string) => Effect.Effect<boolean, HostPathAccessError>;
  pathIsDirectory?: (inputPath: string) => Effect.Effect<boolean, HostPathAccessError>;
  homeDirectory?: () => string;
  realpathFn?: (
    inputPath: string,
  ) => Effect.Effect<string, HostPathAccessError | HostPathNotFoundError>;
};

const OPEN_IN_TOOL_CATALOG: OpenInToolMetadata[] = [
  { id: "finder", label: "Finder", appNames: ["Finder"], launchStrategy: "open-directory" },
  { id: "terminal", label: "Terminal", appNames: ["Terminal"], launchStrategy: "open-directory" },
  {
    id: "iterm2",
    label: "iTerm2",
    appNames: ["iTerm2", "iTerm"],
    launchStrategy: "open-directory",
  },
  { id: "ghostty", label: "Ghostty", appNames: ["Ghostty"], launchStrategy: "open-directory" },
  { id: "vscode", label: "VS Code", appNames: ["Visual Studio Code"], launchStrategy: "editor" },
  { id: "cursor", label: "Cursor", appNames: ["Cursor"], launchStrategy: "editor" },
  { id: "zed", label: "Zed", appNames: ["Zed"], launchStrategy: "editor" },
  {
    id: "intellij-idea",
    label: "IntelliJ IDEA",
    appNames: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
    launchStrategy: "jetbrains",
  },
  { id: "webstorm", label: "WebStorm", appNames: ["WebStorm"], launchStrategy: "jetbrains" },
  {
    id: "pycharm",
    label: "PyCharm",
    appNames: ["PyCharm", "PyCharm CE"],
    launchStrategy: "jetbrains",
  },
  { id: "phpstorm", label: "PhpStorm", appNames: ["PhpStorm"], launchStrategy: "jetbrains" },
  { id: "rider", label: "Rider", appNames: ["Rider"], launchStrategy: "jetbrains" },
  { id: "rustrover", label: "RustRover", appNames: ["RustRover"], launchStrategy: "jetbrains" },
  {
    id: "android-studio",
    label: "Android Studio",
    appNames: ["Android Studio"],
    launchStrategy: "jetbrains",
  },
];

const defaultRunner: OpenInCommandRunner = (program, args, options) =>
  Effect.tryPromise({
    try: () =>
      execFileAsync(program, args, {
        cwd: options?.cwd,
        maxBuffer: 16 * 1024 * 1024,
      }),
    catch: (cause) =>
      toHostOperationError(cause, "openInTools.runCommand", { program, args, cwd: options?.cwd }),
  }).pipe(Effect.map((output) => ({ stdout: output.stdout, stderr: output.stderr })));

const defaultPathExists = (inputPath: string) =>
  Effect.tryPromise({
    try: () => access(inputPath),
    catch: (cause) => toHostPathStatError(cause, "openInTools.pathExists", inputPath),
  }).pipe(
    Effect.as(true),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );

const defaultPathIsDirectory = (inputPath: string) =>
  Effect.tryPromise({
    try: () => stat(inputPath),
    catch: (cause) => toHostPathStatError(cause, "openInTools.pathIsDirectory", inputPath),
  }).pipe(
    Effect.map((metadata) => metadata.isDirectory()),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );

const bundleNameForApp = (appName: string): string =>
  appName.endsWith(".app") ? appName : `${appName}.app`;

const candidateApplicationPaths = (appName: string, homeDirectory: () => string): string[] => {
  const bundleName = bundleNameForApp(appName);
  return [
    `/Applications/${bundleName}`,
    `/System/Applications/${bundleName}`,
    `/System/Applications/Utilities/${bundleName}`,
    `/System/Library/CoreServices/${bundleName}`,
    path.posix.join(homeDirectory(), "Applications", bundleName),
  ];
};

const metadataForTool = (toolId: SystemOpenInToolId): OpenInToolMetadata => {
  const metadata = OPEN_IN_TOOL_CATALOG.find((candidate) => candidate.id === toolId);
  if (!metadata) {
    throw new HostValidationError({
      field: "toolId",
      message: `Unsupported Open In tool: ${toolId}`,
      details: { toolId },
    });
  }
  return metadata;
};

const ensureMacOs = (platform: NodeJS.Platform, operation: string) => {
  if (platform !== "darwin") {
    throw new HostValidationError({
      message: `${operation} is only supported on macOS.`,
      details: { platform, operation },
    });
  }
};

const buildLaunchArgs = (
  metadata: OpenInToolMetadata,
  appPath: string,
  directoryPath: string,
): string[] => {
  if (metadata.launchStrategy === "jetbrains") {
    return ["-na", appPath, "--args", directoryPath];
  }

  return ["-a", appPath, directoryPath];
};

const buildOpenExternalUrlCommand = (
  platform: NodeJS.Platform,
  url: string,
): { program: string; args: string[] } => {
  switch (platform) {
    case "darwin":
      return { program: "open", args: [url] };
    case "linux":
      return { program: "xdg-open", args: [url] };
    case "win32":
      return { program: "cmd", args: ["/C", "start", "", url] };
    default:
      throw new HostValidationError({
        message: `Opening external URLs is not supported on ${platform}.`,
        details: { platform },
      });
  }
};

export const createOpenInToolsAdapter = ({
  platform = process.platform,
  runner = defaultRunner,
  pathExists = defaultPathExists,
  pathIsDirectory = defaultPathIsDirectory,
  homeDirectory = homedir,
  realpathFn = (inputPath) =>
    Effect.tryPromise({
      try: () => realpath(inputPath),
      catch: (cause) => toHostPathStatError(cause, "openInTools.realpath", inputPath),
    }),
}: CreateOpenInToolsAdapterInput = {}): OpenInToolsPort => {
  const runOpenInCommand = (program: string, args: string[], options?: { cwd?: string }) =>
    runner(program, args, options).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "openInTools.runCommand", { program, args, cwd: options?.cwd }),
      ),
    );
  const resolveApplicationPathByName = (
    appName: string,
  ): Effect.Effect<string | null, HostOperationError | HostPathAccessError> =>
    Effect.gen(function* () {
      for (const candidate of candidateApplicationPaths(appName, homeDirectory)) {
        if (yield* pathExists(candidate)) {
          return candidate;
        }
      }

      const bundleName = bundleNameForApp(appName);
      const output = yield* runOpenInCommand("mdfind", ["-name", bundleName]).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (!output) {
        return null;
      }

      for (const line of output.stdout.split(/\r?\n/)) {
        const candidate = line.trim();
        if (
          candidate.length > 0 &&
          candidate.toLowerCase().endsWith(".app") &&
          (yield* pathIsDirectory(candidate))
        ) {
          return candidate;
        }
      }

      return null;
    });

  const resolveApplicationPath = (
    metadata: OpenInToolMetadata,
  ): Effect.Effect<string | null, HostOperationError | HostPathAccessError> =>
    Effect.gen(function* () {
      for (const appName of metadata.appNames) {
        const appPath = yield* resolveApplicationPathByName(appName);
        if (appPath) {
          return appPath;
        }
      }

      return null;
    });

  const buildToolInfo = (
    metadata: OpenInToolMetadata,
    appPath: string,
  ): Effect.Effect<SystemOpenInToolInfo, HostOperationError | HostPathAccessError> =>
    Effect.gen(function* () {
      const iconDataUrl = yield* resolveMacOsAppIconDataUrl({
        appLabel: metadata.label,
        appPath,
        pathExists,
        runner,
      });
      return {
        toolId: metadata.id,
        iconDataUrl,
      };
    });

  const resolveDiscoveredTool = (
    metadata: OpenInToolMetadata,
  ): Effect.Effect<SystemOpenInToolInfo | null, HostOperationError | HostPathAccessError> =>
    Effect.gen(function* () {
      const appPath = yield* resolveApplicationPath(metadata);
      if (!appPath) {
        return null;
      }
      return yield* buildToolInfo(metadata, appPath);
    });

  return {
    canonicalizeDirectory(directoryPath) {
      return realpathFn(directoryPath);
    },
    isDirectory(directoryPath) {
      return pathIsDirectory(directoryPath);
    },
    discoverOpenInTools() {
      return Effect.gen(function* () {
        yield* Effect.try({
          try: () => ensureMacOs(platform, "Open In tool discovery"),
          catch: (cause) => toHostOperationError(cause, "openInTools.ensureMacOs"),
        });

        const discoveredTools = yield* Effect.forEach(OPEN_IN_TOOL_CATALOG, resolveDiscoveredTool, {
          concurrency: "unbounded",
        });
        return discoveredTools.filter((tool): tool is SystemOpenInToolInfo => tool !== null);
      });
    },
    openDirectoryInTool(directoryPath, toolId) {
      return Effect.gen(function* () {
        yield* Effect.try({
          try: () => ensureMacOs(platform, "Opening directories in external tools"),
          catch: (cause) => toHostOperationError(cause, "openInTools.ensureMacOs"),
        });

        const metadata = yield* Effect.try({
          try: () => metadataForTool(toolId),
          catch: (cause) => toHostOperationError(cause, "openInTools.metadataForTool"),
        });
        const appPath = yield* resolveApplicationPath(metadata);
        if (!appPath) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "toolId",
              message: `${metadata.label} is not installed or is no longer discoverable on this Mac.`,
              details: { toolId },
            }),
          );
        }

        yield* runner("open", buildLaunchArgs(metadata, appPath, directoryPath)).pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "openInTools.openDirectoryInTool", {
              directoryPath,
              toolId,
              appPath,
            }),
          ),
          Effect.mapError(
            (error) =>
              new HostOperationError({
                operation: "openInTools.openDirectoryInTool",
                message: `Failed to open ${directoryPath} in ${metadata.label}: ${error.message}`,
                details: { directoryPath, toolId, appPath },
                cause: error,
              }),
          ),
        );
      });
    },
    openExternalUrl(url) {
      return Effect.gen(function* () {
        const command = yield* Effect.try({
          try: () => buildOpenExternalUrlCommand(platform, url),
          catch: (cause) => toHostOperationError(cause, "openInTools.buildOpenExternalUrlCommand"),
        });
        yield* runner(command.program, command.args).pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "openInTools.openExternalUrl", {
              url,
              platform,
              command: command.program,
            }),
          ),
          Effect.mapError(
            (error) =>
              new HostOperationError({
                operation: "openInTools.openExternalUrl",
                message: `Failed to open URL in the system browser: ${error.message}`,
                details: { url, platform, command: command.program },
                cause: error,
              }),
          ),
        );
      });
    },
  };
};
