import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { normalizeUserPathInput } from "@openducktor/path-support";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import { createKeyedSharedFlight } from "../../effect/shared-flight";
import { isExecutableCommandFile } from "../../infrastructure/process/process-command-resolution";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type {
  ResolvedTool,
  ToolDiscoveryDetails,
  ToolDiscoveryError,
  ToolDiscoveryId,
  ToolDiscoveryPort,
  ToolDiscoverySourceCategory,
} from "../../ports/tool-discovery-port";
import {
  DEFAULT_MACOS_APPLICATIONS_DIR,
  describeLocations,
  resolveUserPathForContext,
  TOOL_DISCOVERY_DESCRIPTORS,
  type ToolDiscoveryContext,
  type ToolDiscoveryDescriptor,
  type ToolDiscoveryPathOptions,
} from "./tool-discovery-descriptors";

export type { ToolDiscoveryPathOptions } from "./tool-discovery-descriptors";

const createToolDiscoveryContext = ({
  applicationsDir,
  bundledToolBinDirs,
  homeDir,
  platform,
  providedToolPaths,
}: ToolDiscoveryPathOptions = {}): ToolDiscoveryContext => ({
  applicationsDir: applicationsDir ?? DEFAULT_MACOS_APPLICATIONS_DIR,
  bundledToolBinDirs: bundledToolBinDirs ?? {},
  homeDir: homeDir ?? homedir(),
  platform: platform ?? process.platform,
  providedToolPaths: providedToolPaths ?? {},
});

const resolvePathCommand = (
  command: string,
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    return yield* systemCommands
      .resolveCommandPath(command, { env })
      .pipe(Effect.catchTag("HostPathAccessError", () => Effect.succeed(null)));
  });

const resolveDirectoryCommand = (
  command: string,
  directories: readonly string[],
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    return yield* systemCommands
      .resolveCommandPath(command, { env, searchPath: directories })
      .pipe(Effect.catchTag("HostPathAccessError", () => Effect.succeed(null)));
  });

const invalidOverrideError = (
  descriptor: ToolDiscoveryDescriptor,
  variable: string,
  message: string,
  details?: ToolDiscoveryDetails,
) => {
  if (details === undefined) {
    return new HostValidationError({
      field: variable,
      message: `Configured ${descriptor.displayName} override ${variable} ${message}`,
    });
  }
  return new HostValidationError({
    field: variable,
    message: `Configured ${descriptor.displayName} override ${variable} ${message}`,
    details,
  });
};

const invalidProvidedToolPathError = (
  descriptor: ToolDiscoveryDescriptor,
  toolId: ToolDiscoveryId,
  message: string,
  details?: ToolDiscoveryDetails,
) => {
  if (details === undefined) {
    return new HostValidationError({
      field: `providedToolPaths.${toolId}`,
      message: `Provided ${descriptor.displayName} path for ${toolId} ${message}`,
    });
  }
  return new HostValidationError({
    field: `providedToolPaths.${toolId}`,
    message: `Provided ${descriptor.displayName} path for ${toolId} ${message}`,
    details,
  });
};

const invalidSavedToolPathError = (
  descriptor: ToolDiscoveryDescriptor,
  toolId: ToolDiscoveryId,
  message: string,
  details?: ToolDiscoveryDetails,
) => {
  if (details === undefined) {
    return new HostValidationError({
      field: `agentRuntimes.${toolId}.executablePath`,
      message: `Saved ${descriptor.displayName} path ${message}`,
    });
  }
  return new HostValidationError({
    field: `agentRuntimes.${toolId}.executablePath`,
    message: `Saved ${descriptor.displayName} path ${message}`,
    details,
  });
};

const resolveExplicitToolPathSource = ({
  context,
  detailKey,
  env,
  displayLabel,
  invalidError,
  rawPath,
  sourceCategory,
  systemCommands,
}: {
  context: ToolDiscoveryContext;
  detailKey: "executablePath" | "resolvedOverride" | "resolvedProvidedPath";
  displayLabel: string;
  env: NodeJS.ProcessEnv;
  invalidError: (
    message: string,
    details?: ToolDiscoveryDetails,
  ) => HostValidationError<ToolDiscoveryDetails>;
  rawPath: string;
  sourceCategory: ToolDiscoverySourceCategory;
  systemCommands: SystemCommandPort;
}) =>
  Effect.gen(function* () {
    const normalizedPath = normalizeUserPathInput(rawPath);
    if (!normalizedPath) {
      return yield* Effect.fail(invalidError("is empty"));
    }

    const resolvedPath = resolveUserPathForContext(normalizedPath, context);
    const resolved = yield* resolvePathCommand(resolvedPath, systemCommands, env);
    if (resolved !== null) {
      return { displayLabel, path: resolved, sourceCategory } satisfies ResolvedTool;
    }

    let details: ToolDiscoveryDetails;
    if (detailKey === "resolvedOverride") {
      details = { resolvedOverride: resolvedPath };
    } else if (detailKey === "resolvedProvidedPath") {
      details = { resolvedProvidedPath: resolvedPath };
    } else {
      details = { executablePath: resolvedPath };
    }
    return yield* Effect.fail(
      invalidError(`points to a missing or non-executable file: ${resolvedPath}`, details),
    );
  });

const missingToolError = (descriptor: ToolDiscoveryDescriptor, checked: readonly string[]) =>
  new HostDependencyError<ToolDiscoveryDetails>({
    dependency: descriptor.command,
    operation: "toolDiscovery.discoverTool",
    message: `${descriptor.command} not found. Checked ${checked.join(
      ", ",
    )}. ${descriptor.installHint}`,
  });

const missingRequiredSourceError = (
  descriptor: ToolDiscoveryDescriptor,
  checked: readonly string[],
  directories: readonly string[],
) =>
  new HostDependencyError<ToolDiscoveryDetails>({
    dependency: descriptor.command,
    operation: "toolDiscovery.discoverTool",
    message: `${descriptor.command} not found. Checked ${checked.join(", ")}. ${descriptor.installHint}`,
    details: { directories, requiredSource: true },
  });

const discoverDescriptorToolPath = ({
  descriptor,
  env,
  options,
  systemCommands,
  toolId,
}: {
  descriptor: ToolDiscoveryDescriptor;
  env: NodeJS.ProcessEnv;
  options: ToolDiscoveryPathOptions;
  systemCommands: SystemCommandPort;
  toolId: ToolDiscoveryId;
}) =>
  Effect.gen(function* () {
    const context = createToolDiscoveryContext(options);
    const checked: string[] = [];
    checked.push(descriptor.overrideVariable);
    const rawOverride = env[descriptor.overrideVariable];
    if (rawOverride !== undefined) {
      return yield* resolveExplicitToolPathSource({
        context,
        detailKey: "resolvedOverride",
        displayLabel: "Environment override",
        env,
        invalidError: (message, details) =>
          invalidOverrideError(descriptor, descriptor.overrideVariable, message, details),
        rawPath: rawOverride,
        sourceCategory: "environment_override",
        systemCommands,
      });
    }

    const rawProvidedPath = context.providedToolPaths[toolId];
    if (rawProvidedPath !== undefined) {
      checked.push(`provided ${toolId} path`);
      return yield* resolveExplicitToolPathSource({
        context,
        detailKey: "resolvedProvidedPath",
        displayLabel: "Provided path",
        env,
        invalidError: (message, details) =>
          invalidProvidedToolPathError(descriptor, toolId, message, details),
        rawPath: rawProvidedPath,
        sourceCategory: "provided_path",
        systemCommands,
      });
    }

    for (const source of descriptor.sources) {
      switch (source.kind) {
        case "candidateFiles": {
          const candidates = source.candidates(context);
          checked.push(`${source.label} (${describeLocations(candidates)})`);
          for (const candidate of candidates) {
            if (yield* isExecutableCommandFile(candidate, context.platform)) {
              return {
                displayLabel: source.label,
                path: candidate,
                sourceCategory: "system_path",
              } satisfies ResolvedTool;
            }
          }
          break;
        }

        case "searchDirectories": {
          const directories = source
            .directories(context)
            .filter((directory): directory is string => directory !== undefined)
            .map((directory) => resolveUserPathForContext(directory, context));
          if (directories.length === 0) {
            break;
          }
          checked.push(`${source.label} (${describeLocations(directories)})`);
          const resolved = yield* resolveDirectoryCommand(
            descriptor.command,
            directories,
            systemCommands,
            env,
          );
          if (resolved !== null) {
            return {
              displayLabel: source.label,
              path: resolved,
              sourceCategory: "system_path",
            } satisfies ResolvedTool;
          }
          if (source.policy === "required") {
            return yield* Effect.fail(missingRequiredSourceError(descriptor, checked, directories));
          }
          break;
        }
      }
    }

    checked.push("PATH");
    const pathCommand = yield* resolvePathCommand(descriptor.command, systemCommands, env);
    if (pathCommand !== null) {
      return {
        displayLabel: "System PATH",
        path: pathCommand,
        sourceCategory: "system_path",
      } satisfies ResolvedTool;
    }

    return yield* Effect.fail(missingToolError(descriptor, checked));
  });
const discoverToolPath = (
  toolId: ToolDiscoveryId,
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv = process.env,
  options: ToolDiscoveryPathOptions = {},
) =>
  discoverDescriptorToolPath({
    descriptor: TOOL_DISCOVERY_DESCRIPTORS[toolId],
    env,
    options,
    systemCommands,
    toolId,
  });

export const createToolDiscoveryAdapter = ({
  readEnv = () => process.env,
  options = {},
  systemCommands,
}: {
  /** Reads the environment for each discovery, so it uses the latest user PATH. */
  readEnv?: () => NodeJS.ProcessEnv;
  options?: ToolDiscoveryPathOptions;
  systemCommands: SystemCommandPort;
}): ToolDiscoveryPort => {
  const cachedTools = new Map<ToolDiscoveryId, ResolvedTool>();
  const flight = createKeyedSharedFlight<ToolDiscoveryId, ResolvedTool, ToolDiscoveryError>();

  const resolveTool: ToolDiscoveryPort["resolveTool"] = (toolId) =>
    Effect.suspend(() => {
      const cachedTool = cachedTools.get(toolId);
      if (cachedTool !== undefined) {
        return Effect.succeed(cachedTool);
      }
      return flight.run(
        toolId,
        Effect.suspend(() => discoverToolPath(toolId, systemCommands, readEnv(), options)).pipe(
          Effect.tap((tool) =>
            Effect.sync(() => {
              cachedTools.set(toolId, tool);
            }),
          ),
        ),
      );
    });

  return {
    discoverTool(toolId) {
      return discoverToolPath(toolId, systemCommands, readEnv(), options);
    },
    resolveTool,
    resolveToolPath(toolId) {
      return resolveTool(toolId).pipe(Effect.map((resolvedTool) => resolvedTool.path));
    },
    validateToolPath(toolId, executablePath) {
      const descriptor = TOOL_DISCOVERY_DESCRIPTORS[toolId];
      const context = createToolDiscoveryContext(options);
      const normalizedPath = normalizeUserPathInput(executablePath);
      const resolvedPath = resolveUserPathForContext(normalizedPath, context);
      const pathApi = context.platform === "win32" ? win32 : posix;
      if (normalizedPath && !pathApi.isAbsolute(resolvedPath)) {
        return Effect.fail(
          invalidSavedToolPathError(descriptor, toolId, `"${resolvedPath}" must be absolute`, {
            executablePath: resolvedPath,
          }),
        );
      }
      return resolveExplicitToolPathSource({
        context,
        detailKey: "executablePath",
        displayLabel: "Saved path",
        env: readEnv(),
        invalidError: (message, details) =>
          invalidSavedToolPathError(descriptor, toolId, message, details),
        rawPath: executablePath,
        sourceCategory: "provided_path",
        systemCommands,
      });
    },
  };
};
