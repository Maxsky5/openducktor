import { homedir } from "node:os";
import { posix, win32 } from "node:path";
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
};

export type ToolDiscoveryContext = {
  applicationsDir: string;
  bundledToolBinDirs: Partial<Record<ToolDiscoveryId, string>>;
  homeDir: string;
  platform: NodeJS.Platform;
};

export type ToolDiscoverySource =
  | { kind: "environment"; variable: string }
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
    }
  | { kind: "path" };

export type ToolDiscoveryDescriptor = {
  command: string;
  displayName: string;
  installHint: string;
  sources: ToolDiscoverySource[];
};

const DEFAULT_MACOS_APPLICATIONS_DIR = "/Applications";

const stripMatchingQuotes = (value: string): string =>
  value.length >= 2 &&
  ((value.at(0) === `"` && value.at(-1) === `"`) || (value.at(0) === `'` && value.at(-1) === `'`))
    ? value.slice(1, -1)
    : value;

const joinPlatformPath = (platform: NodeJS.Platform, ...segments: string[]): string =>
  platform === "win32" ? win32.join(...segments) : posix.join(...segments);

export const resolveUserPath = (
  rawPath: string,
  homeDir = homedir(),
  platform: NodeJS.Platform = process.platform,
): string => {
  const trimmed = stripMatchingQuotes(rawPath.trim());
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return joinPlatformPath(platform, homeDir, trimmed.slice(2));
  }
  return trimmed;
};

const joinToolPath = (
  context: Pick<ToolDiscoveryContext, "platform">,
  ...segments: string[]
): string => joinPlatformPath(context.platform, ...segments);

const createToolDiscoveryContext = ({
  applicationsDir,
  bundledToolBinDirs,
  homeDir,
  platform,
}: ToolDiscoveryPathOptions = {}): ToolDiscoveryContext => ({
  applicationsDir: applicationsDir ?? DEFAULT_MACOS_APPLICATIONS_DIR,
  bundledToolBinDirs: bundledToolBinDirs ?? {},
  homeDir: homeDir ?? homedir(),
  platform: platform ?? process.platform,
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

export const discoverToolPath = (
  descriptor: ToolDiscoveryDescriptor,
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv = process.env,
  options: ToolDiscoveryPathOptions = {},
) =>
  Effect.gen(function* () {
    const context = createToolDiscoveryContext(options);
    const checked: string[] = [];
    for (const source of descriptor.sources) {
      switch (source.kind) {
        case "environment": {
          checked.push(source.variable);
          const rawOverride = env[source.variable];
          if (rawOverride === undefined) {
            break;
          }
          if (rawOverride.trim().length === 0) {
            return yield* Effect.fail(
              invalidOverrideError(descriptor, source.variable, "is empty"),
            );
          }
          const resolvedOverride = resolveUserPath(rawOverride, context.homeDir, context.platform);
          const resolved = yield* resolvePathCommand(resolvedOverride, systemCommands, env);
          if (resolved !== null) {
            return resolved;
          }
          return yield* Effect.fail(
            invalidOverrideError(
              descriptor,
              source.variable,
              `points to a missing or non-executable file: ${resolvedOverride}`,
              { resolvedOverride },
            ),
          );
        }

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
            .map((directory) => resolveUserPath(directory, context.homeDir, context.platform));
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

        case "path": {
          checked.push("PATH");
          const pathCommand = yield* resolvePathCommand(descriptor.command, systemCommands, env);
          if (pathCommand !== null) {
            return pathCommand;
          }
          break;
        }
      }
    }

    return yield* Effect.fail(missingToolError(descriptor, checked));
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
  sources: [{ kind: "environment", variable: overrideVariable }, ...sources, { kind: "path" }],
});

export const BUN_TOOL_DESCRIPTOR = commandTool({
  command: "bun",
  overrideVariable: "OPENDUCKTOR_BUN_PATH",
});
export const GIT_TOOL_DESCRIPTOR = commandTool({
  command: "git",
  overrideVariable: "OPENDUCKTOR_GIT_PATH",
});
export const GITHUB_CLI_TOOL_DESCRIPTOR = commandTool({
  command: "gh",
  displayName: "GitHub CLI",
  installHint: "Install GitHub CLI and ensure gh is available on PATH, or set OPENDUCKTOR_GH_PATH.",
  overrideVariable: "OPENDUCKTOR_GH_PATH",
});
export const BEADS_TOOL_DESCRIPTOR = commandTool({
  command: "bd",
  displayName: "Beads",
  overrideVariable: "OPENDUCKTOR_BD_PATH",
});
export const DOLT_TOOL_DESCRIPTOR = commandTool({
  command: "dolt",
  displayName: "Dolt",
  overrideVariable: "OPENDUCKTOR_DOLT_PATH",
});

export const OPENCODE_TOOL_DESCRIPTOR: ToolDiscoveryDescriptor = commandTool({
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

export const CODEX_TOOL_DESCRIPTOR: ToolDiscoveryDescriptor = commandTool({
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
        const applicationsDir = resolveUserPath(
          context.applicationsDir,
          context.homeDir,
          context.platform,
        );
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

export const TOOL_DISCOVERY_DESCRIPTORS: Record<ToolDiscoveryId, ToolDiscoveryDescriptor> = {
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
      const exit = yield* Effect.exit(
        discoverToolPath(TOOL_DISCOVERY_DESCRIPTORS[toolId], systemCommands, env, options),
      );
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
