import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { normalizeUserPathInput, resolveNormalizedUserPath } from "@openducktor/path-support";
import { Deferred, Effect, FiberId } from "effect";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import { isExecutableCommandFile } from "../../infrastructure/process/process-command-resolution";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type {
  ToolDiscoveryError,
  ToolDiscoveryId,
  ToolDiscoveryPort,
} from "../../ports/tool-discovery-port";

export type ToolDiscoveryPathOptions = {
  applicationsDir?: string;
  bundledToolBinDirs?: Partial<Record<ToolDiscoveryId, string>>;
  homeDir?: string;
  platform?: NodeJS.Platform;
  providedToolPaths?: Partial<Record<ToolDiscoveryId, string>>;
};

type ToolDiscoveryContext = {
  applicationsDir: string;
  bundledToolBinDirs: Partial<Record<ToolDiscoveryId, string>>;
  homeDir: string;
  platform: NodeJS.Platform;
  providedToolPaths: Partial<Record<ToolDiscoveryId, string>>;
};

type ToolDiscoverySource =
  | {
      directories: (context: ToolDiscoveryContext) => (string | undefined)[];
      kind: "searchDirectories";
      label?: string;
      policy: "candidate" | "required";
    }
  | {
      candidates: (context: ToolDiscoveryContext) => string[];
      kind: "candidateFiles";
      label: string;
    };

type ToolDiscoveryDescriptor = {
  command: string;
  displayName: string;
  installHint: string;
  overrideVariable: string;
  sources: ToolDiscoverySource[];
};

const DEFAULT_MACOS_APPLICATIONS_DIR = "/Applications";

const joinToolPath = (
  context: Pick<ToolDiscoveryContext, "platform">,
  ...segments: string[]
): string => (context.platform === "win32" ? win32.join(...segments) : posix.join(...segments));

const resolveUserPathForContext = (rawPath: string, context: ToolDiscoveryContext): string =>
  resolveNormalizedUserPath(normalizeUserPathInput(rawPath), {
    homeDir: context.homeDir,
    joinHomePath: (homeDir, relativePath) => joinToolPath(context, homeDir, relativePath),
  });

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

const describeLocations = (locations: string[]): string =>
  locations.length > 0 ? locations.join(", ") : "none configured";

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
  invalidError,
  rawPath,
  systemCommands,
}: {
  context: ToolDiscoveryContext;
  detailKey: string;
  env: NodeJS.ProcessEnv;
  invalidError: (message: string, details?: Record<string, unknown>) => HostValidationError;
  rawPath: string;
  systemCommands: SystemCommandPort;
}) =>
  Effect.gen(function* () {
    const normalizedPath = normalizeUserPathInput(rawPath);
    if (!normalizedPath) {
      return yield* Effect.fail(invalidError("is empty"));
    }

    const resolvedPath = resolveNormalizedUserPath(normalizedPath, {
      homeDir: context.homeDir,
      joinHomePath: (homeDir, relativePath) => joinToolPath(context, homeDir, relativePath),
    });
    const resolved = yield* resolvePathCommand(resolvedPath, systemCommands, env);
    if (resolved !== null) {
      return resolved;
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
        env,
        invalidError: (message, details) =>
          invalidOverrideError(descriptor, descriptor.overrideVariable, message, details),
        rawPath: rawOverride,
        systemCommands,
      });
    }

    const rawProvidedPath = context.providedToolPaths[toolId];
    if (rawProvidedPath !== undefined) {
      checked.push(`provided ${toolId} path`);
      return yield* resolveExplicitToolPathSource({
        context,
        detailKey: "resolvedProvidedPath",
        env,
        invalidError: (message, details) =>
          invalidProvidedToolPathError(descriptor, toolId, message, details),
        rawPath: rawProvidedPath,
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
              return candidate;
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
            return resolved;
          }
          if (source.policy === "required") {
            return yield* Effect.fail(missingToolError(descriptor, checked, { directories }));
          }
          break;
        }
      }
    }

    checked.push("PATH");
    const pathCommand = yield* resolvePathCommand(descriptor.command, systemCommands, env);
    if (pathCommand !== null) {
      return pathCommand;
    }

    return yield* Effect.fail(missingToolError(descriptor, checked));
  });

/** @internal Test-only seam for tool path discovery coverage. */
export const discoverToolPath = (
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

const commandTool = ({
  command,
  displayName = command,
  installHint,
  overrideVariable,
  sources = [],
}: {
  command: string;
  displayName?: string;
  installHint?: string;
  overrideVariable: string;
  sources?: ToolDiscoverySource[];
}): ToolDiscoveryDescriptor => ({
  command,
  displayName,
  installHint:
    installHint ??
    `Install ${command} and ensure it is available on PATH, or set ${overrideVariable}.`,
  overrideVariable,
  sources,
});

const BUN_TOOL_DESCRIPTOR = commandTool({
  command: "bun",
  overrideVariable: "OPENDUCKTOR_BUN_PATH",
});
const GIT_TOOL_DESCRIPTOR = commandTool({
  command: "git",
  overrideVariable: "OPENDUCKTOR_GIT_PATH",
});
const GITHUB_CLI_TOOL_DESCRIPTOR = commandTool({
  command: "gh",
  displayName: "GitHub CLI",
  installHint: "Install GitHub CLI and ensure gh is available on PATH, or set OPENDUCKTOR_GH_PATH.",
  overrideVariable: "OPENDUCKTOR_GH_PATH",
});
const BEADS_TOOL_DESCRIPTOR = commandTool({
  command: "bd",
  displayName: "Beads",
  overrideVariable: "OPENDUCKTOR_BD_PATH",
});
const DOLT_TOOL_DESCRIPTOR = commandTool({
  command: "dolt",
  displayName: "Dolt",
  overrideVariable: "OPENDUCKTOR_DOLT_PATH",
});

const OPENCODE_TOOL_DESCRIPTOR: ToolDiscoveryDescriptor = commandTool({
  command: "opencode",
  displayName: "OpenCode",
  installHint: "Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.",
  overrideVariable: "OPENDUCKTOR_OPENCODE_BINARY",
  sources: [
    {
      directories: (context) => [context.bundledToolBinDirs.opencode],
      kind: "searchDirectories",
      label: "bundled tool directory",
      policy: "required",
    },
    {
      directories: (context) => [joinToolPath(context, context.homeDir, ".opencode", "bin")],
      kind: "searchDirectories",
      label: "standard install directories",
      policy: "candidate",
    },
  ],
});

const CODEX_TOOL_DESCRIPTOR: ToolDiscoveryDescriptor = commandTool({
  command: "codex",
  displayName: "Codex",
  installHint: "Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.",
  overrideVariable: "OPENDUCKTOR_CODEX_BINARY",
  sources: [
    {
      directories: (context) => [context.bundledToolBinDirs.codex],
      kind: "searchDirectories",
      label: "bundled tool directory",
      policy: "required",
    },
    {
      candidates: (context) => {
        if (context.platform !== "darwin") {
          return [];
        }
        const appPath = ["Codex.app", "Contents", "Resources", "codex"];
        const applicationsDir = resolveUserPathForContext(context.applicationsDir, context);
        return [
          joinToolPath(context, applicationsDir, ...appPath),
          joinToolPath(context, context.homeDir, "Applications", ...appPath),
        ];
      },
      kind: "candidateFiles",
      label: "standard install locations",
    },
  ],
});

const TOOL_DISCOVERY_DESCRIPTORS: Record<ToolDiscoveryId, ToolDiscoveryDescriptor> = {
  beads: BEADS_TOOL_DESCRIPTOR,
  bun: BUN_TOOL_DESCRIPTOR,
  codex: CODEX_TOOL_DESCRIPTOR,
  dolt: DOLT_TOOL_DESCRIPTOR,
  git: GIT_TOOL_DESCRIPTOR,
  githubCli: GITHUB_CLI_TOOL_DESCRIPTOR,
  opencode: OPENCODE_TOOL_DESCRIPTOR,
};

type ToolDiscoveryFlight = {
  deferred: Deferred.Deferred<string, ToolDiscoveryError>;
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
  const cachedPaths = new Map<ToolDiscoveryId, string>();
  const flights = new Map<ToolDiscoveryId, ToolDiscoveryFlight>();

  const completeFlight = (toolId: ToolDiscoveryId, flight: ToolDiscoveryFlight) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(discoverToolPath(toolId, systemCommands, env, options));
      if (exit._tag === "Success") {
        cachedPaths.set(toolId, exit.value);
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

  return {
    resolveToolPath(toolId) {
      const cachedPath = cachedPaths.get(toolId);
      if (cachedPath !== undefined) {
        return Effect.succeed(cachedPath);
      }

      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const reservation = yield* Effect.sync(() => {
            const reservedCachedPath = cachedPaths.get(toolId);
            if (reservedCachedPath !== undefined) {
              return { _tag: "cached" as const, path: reservedCachedPath };
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
            return reservation.path;
          }

          if (reservation._tag === "created") {
            yield* Effect.forkDaemon(completeFlight(toolId, reservation.flight));
          }

          return yield* restore(Deferred.await(reservation.flight.deferred));
        }),
      );
    },
  };
};
