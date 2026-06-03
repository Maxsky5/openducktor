import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
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
import type { SystemCommandPort } from "../../ports/system-command-port";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { resolveMacOsAppIconDataUrl } from "./macos-open-in-icons";
import {
  COMMAND_OPEN_IN_TOOL_CATALOG,
  type CommandOpenInToolMetadata,
  commandMetadataForTool,
  MAC_OPEN_IN_TOOL_CATALOG,
  type MacOpenInToolMetadata,
  macMetadataForTool,
} from "./open-in-tool-catalog";

export type CreateOpenInToolsAdapterInput = {
  platform?: NodeJS.Platform;
  pathExists?: (inputPath: string) => Effect.Effect<boolean, HostPathAccessError>;
  pathIsDirectory?: (inputPath: string) => Effect.Effect<boolean, HostPathAccessError>;
  homeDirectory?: () => string;
  realpathFn?: (
    inputPath: string,
  ) => Effect.Effect<string, HostPathAccessError | HostPathNotFoundError>;
  systemCommands?: Pick<SystemCommandPort, "resolveCommandPath" | "runCommandAllowFailure">;
  processEnv?: NodeJS.ProcessEnv;
};

type RunOpenInCommand = Pick<SystemCommandPort, "runCommandAllowFailure">["runCommandAllowFailure"];

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

const buildLaunchArgs = (
  metadata: MacOpenInToolMetadata,
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
      return { program: "explorer.exe", args: [url] };
    default:
      throw new HostValidationError({
        message: `Opening external URLs is not supported on ${platform}.`,
        details: { platform },
      });
  }
};

export const createOpenInToolsAdapter = ({
  platform = process.platform,
  pathExists = defaultPathExists,
  pathIsDirectory = defaultPathIsDirectory,
  homeDirectory = homedir,
  processEnv = process.env,
  systemCommands = createSystemCommandRunner({ env: processEnv, platform }),
  realpathFn = (inputPath) =>
    Effect.tryPromise({
      try: () => realpath(inputPath),
      catch: (cause) => toHostPathStatError(cause, "openInTools.realpath", inputPath),
    }),
}: CreateOpenInToolsAdapterInput = {}): OpenInToolsPort => {
  const runOpenInCommand: RunOpenInCommand = (command, args, options) =>
    systemCommands.runCommandAllowFailure(command, args, options);
  const runRequiredOpenInCommand = (program: string, args: string[], options?: { cwd?: string }) =>
    runOpenInCommand(program, args, options).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "openInTools.runCommand", { program, args, cwd: options?.cwd }),
      ),
      Effect.flatMap((result) =>
        result.ok
          ? Effect.succeed(result)
          : Effect.fail(
              new HostOperationError({
                operation: "openInTools.runCommand",
                message: `Command ${program} exited unsuccessfully.`,
                details: { program, args, cwd: options?.cwd, stderr: result.stderr },
              }),
            ),
      ),
    );
  const supportedCommandMetadata = () =>
    COMMAND_OPEN_IN_TOOL_CATALOG.filter((metadata) => metadata.platforms.includes(platform));
  const resolveCommandPath = (command: string) => systemCommands.resolveCommandPath(command);
  const resolveCommandTool = (metadata: CommandOpenInToolMetadata) =>
    Effect.gen(function* () {
      for (const command of metadata.commands) {
        const resolvedCommand = yield* resolveCommandPath(command);
        if (resolvedCommand) {
          return {
            metadata,
            command,
            resolvedCommand,
          };
        }
      }
      return null;
    });
  const resolveCommandToolOrFail = (toolId: SystemOpenInToolId) =>
    Effect.gen(function* () {
      const metadata = yield* Effect.try({
        try: () => commandMetadataForTool(toolId, platform),
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : toHostOperationError(cause, "openInTools.commandMetadataForTool"),
      });
      const resolved = yield* resolveCommandTool(metadata);
      if (!resolved) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "toolId",
            message: `${metadata.label} is not installed or is no longer discoverable on ${platform}.`,
            details: { toolId, platform, commands: metadata.commands },
          }),
        );
      }
      return resolved;
    });
  const openDirectoryWithCommandTool = (
    metadata: CommandOpenInToolMetadata,
    command: string,
    resolvedCommand: string,
    directoryPath: string,
  ) =>
    Effect.gen(function* () {
      const args = metadata.args?.(directoryPath, command) ?? [directoryPath];
      const result = yield* systemCommands
        .runCommandAllowFailure(resolvedCommand, args, {
          cwd: directoryPath,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new HostOperationError({
                operation: "openInTools.openDirectoryInTool",
                message: `Failed to open ${directoryPath} in ${metadata.label}: ${error.message}`,
                details: {
                  platform,
                  toolId: metadata.id,
                  directoryPath,
                  command,
                  resolvedCommand,
                  args,
                },
                cause: error,
              }),
          ),
        );
      if (!result.ok && metadata.allowNonZeroExit !== true) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "openInTools.openDirectoryInTool",
            message: `Failed to open ${directoryPath} in ${metadata.label}. Command ${command} exited unsuccessfully.`,
            details: {
              platform,
              toolId: metadata.id,
              directoryPath,
              command,
              resolvedCommand,
              args,
              stderr: result.stderr,
            },
          }),
        );
      }
    });
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
      const output = yield* runRequiredOpenInCommand("mdfind", ["-name", bundleName]).pipe(
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
    metadata: MacOpenInToolMetadata,
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
    metadata: MacOpenInToolMetadata,
    appPath: string,
  ): Effect.Effect<SystemOpenInToolInfo, HostOperationError | HostPathAccessError> =>
    Effect.gen(function* () {
      const iconDataUrl = yield* resolveMacOsAppIconDataUrl({
        appLabel: metadata.label,
        appPath,
        pathExists,
        runCommand: runOpenInCommand,
      });
      return {
        toolId: metadata.id,
        iconDataUrl,
      };
    });

  const resolveDiscoveredTool = (
    metadata: MacOpenInToolMetadata,
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
        if (platform === "darwin") {
          const discoveredTools = yield* Effect.forEach(
            MAC_OPEN_IN_TOOL_CATALOG,
            resolveDiscoveredTool,
            {
              concurrency: "unbounded",
            },
          );
          return discoveredTools.filter((tool): tool is SystemOpenInToolInfo => tool !== null);
        }

        const commandMetadata = supportedCommandMetadata();
        if (commandMetadata.length === 0) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Open In tool discovery is not supported on ${platform}.`,
              details: { platform },
            }),
          );
        }

        const discoveredTools = yield* Effect.forEach(commandMetadata, resolveCommandTool, {
          concurrency: "unbounded",
        });
        return discoveredTools
          .filter(
            (
              tool,
            ): tool is {
              metadata: CommandOpenInToolMetadata;
              command: string;
              resolvedCommand: string;
            } => tool !== null,
          )
          .map(({ metadata }) => ({ toolId: metadata.id, iconDataUrl: null }));
      });
    },
    openDirectoryInTool(directoryPath, toolId) {
      return Effect.gen(function* () {
        if (platform !== "darwin") {
          const { metadata, command, resolvedCommand } = yield* resolveCommandToolOrFail(toolId);
          yield* openDirectoryWithCommandTool(metadata, command, resolvedCommand, directoryPath);
          return;
        }

        const metadata = yield* Effect.try({
          try: () => macMetadataForTool(toolId),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : toHostOperationError(cause, "openInTools.macMetadataForTool"),
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

        yield* runRequiredOpenInCommand(
          "open",
          buildLaunchArgs(metadata, appPath, directoryPath),
        ).pipe(
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
        const result = yield* systemCommands
          .runCommandAllowFailure(command.program, command.args)
          .pipe(
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
        if (!result.ok) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "openInTools.openExternalUrl",
              message: "Failed to open URL in the system browser. Command exited unsuccessfully.",
              details: {
                url,
                platform,
                command: command.program,
                args: command.args,
                stderr: result.stderr,
              },
            }),
          );
        }
      });
    },
  };
};
