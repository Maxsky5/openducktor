import { homedir } from "node:os";
import { normalizeUserPathInput } from "@openducktor/path-support";
import { Deferred, Effect, FiberId } from "effect";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import { isExecutableCommandFile } from "../../infrastructure/process/process-command-resolution";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type {
  ResolvedTool,
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
  type ToolDiscoverySource,
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
  details?: Record<string, unknown>,
) =>
  new HostValidationError({
    field: variable,
    message: `Configured ${descriptor.displayName} override ${variable} ${message}`,
    details,
  });

const invalidProvidedToolPathError = (
  descriptor: ToolDiscoveryDescriptor,
  toolId: ToolDiscoveryId,
  message: string,
  details?: Record<string, unknown>,
) =>
  new HostValidationError({
    field: `providedToolPaths.${toolId}`,
    message: `Provided ${descriptor.displayName} path for ${toolId} ${message}`,
    details,
  });

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
  detailKey: string;
  displayLabel: string;
  env: NodeJS.ProcessEnv;
  invalidError: (message: string, details?: Record<string, unknown>) => HostValidationError;
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

    return yield* Effect.fail(
      invalidError(`points to a missing or non-executable file: ${resolvedPath}`, {
        [detailKey]: resolvedPath,
      }),
    );
  });

const missingToolError = (
  descriptor: ToolDiscoveryDescriptor,
  checked: readonly string[],
  details?: Record<string, unknown>,
) =>
  new HostDependencyError({
    dependency: descriptor.command,
    operation: "toolDiscovery.discoverTool",
    message: `${descriptor.command} not found. Checked ${checked.join(
      ", ",
    )}. ${descriptor.installHint}`,
    details,
  });

const missingRequiredSourceError = (
  descriptor: ToolDiscoveryDescriptor,
  checked: readonly string[],
  source: Extract<ToolDiscoverySource, { kind: "searchDirectories" }>,
  directories: readonly string[],
) =>
  new HostDependencyError({
    dependency: descriptor.command,
    operation: "toolDiscovery.discoverTool",
    message:
      source.requiredMissingMessage?.({ descriptor, directories }) ??
      `${descriptor.command} not found. Checked ${checked.join(", ")}. ${descriptor.installHint}`,
    details: { directories },
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
                displayLabel: source.displayLabel ?? source.label,
                path: candidate,
                sourceCategory: source.sourceCategory ?? "system_path",
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
          checked.push(
            `${source.label ?? "search directories"} (${describeLocations(directories)})`,
          );
          const resolved = yield* resolveDirectoryCommand(
            descriptor.command,
            directories,
            systemCommands,
            env,
          );
          if (resolved !== null) {
            return {
              displayLabel: source.displayLabel ?? source.label ?? "Search directory",
              path: resolved,
              sourceCategory: source.sourceCategory ?? "system_path",
            } satisfies ResolvedTool;
          }
          if (source.policy === "required") {
            return yield* Effect.fail(
              missingRequiredSourceError(descriptor, checked, source, directories),
            );
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

type ToolDiscoveryFlight = {
  deferred: Deferred.Deferred<ResolvedTool, ToolDiscoveryError>;
};

const makeToolDiscoveryFlight = (): ToolDiscoveryFlight => ({
  deferred: Deferred.unsafeMake(FiberId.none),
});

export const createToolDiscoveryAdapter = ({
  env = process.env,
  options = {},
  systemCommands,
}: {
  env?: NodeJS.ProcessEnv;
  options?: ToolDiscoveryPathOptions;
  systemCommands: SystemCommandPort;
}): ToolDiscoveryPort => {
  const cachedTools = new Map<ToolDiscoveryId, ResolvedTool>();
  const flights = new Map<ToolDiscoveryId, ToolDiscoveryFlight>();

  const completeFlight = (toolId: ToolDiscoveryId, flight: ToolDiscoveryFlight) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(discoverToolPath(toolId, systemCommands, env, options));
      if (exit._tag === "Success") {
        cachedTools.set(toolId, exit.value);
      }
      yield* Deferred.done(flight.deferred, exit);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (flights.get(toolId) === flight) {
            flights.delete(toolId);
          }
        }),
      ),
    );

  const resolveTool: ToolDiscoveryPort["resolveTool"] = (toolId) => {
    const cachedTool = cachedTools.get(toolId);
    if (cachedTool !== undefined) {
      return Effect.succeed(cachedTool);
    }

    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const reservation = yield* Effect.sync(() => {
          const reservedCachedTool = cachedTools.get(toolId);
          if (reservedCachedTool !== undefined) {
            return { _tag: "cached" as const, tool: reservedCachedTool };
          }

          const existingFlight = flights.get(toolId);
          if (existingFlight) {
            return { _tag: "existing" as const, flight: existingFlight };
          }

          const flight = makeToolDiscoveryFlight();
          flights.set(toolId, flight);
          return { _tag: "created" as const, flight };
        });

        if (reservation._tag === "cached") {
          return reservation.tool;
        }

        if (reservation._tag === "created") {
          yield* Effect.forkDaemon(completeFlight(toolId, reservation.flight));
        }

        return yield* restore(Deferred.await(reservation.flight.deferred));
      }),
    );
  };

  return {
    resolveTool,
    resolveToolPath(toolId) {
      return resolveTool(toolId).pipe(Effect.map((resolvedTool) => resolvedTool.path));
    },
  };
};
