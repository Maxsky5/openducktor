import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  HostDependencyError,
  HostValidationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryId, ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export type ToolDiscoveryPathOptions = {
  applicationsDir?: string;
  bundledToolBinDir?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

export type ToolDiscoveryContext = {
  applicationsDir: string;
  bundledToolBinDir?: string;
  homeDir: string;
  platform: NodeJS.Platform;
};

export type ToolDiscoverySource =
  | { kind: "environment"; variable: string }
  | { kind: "bundledToolBin"; policy: "candidate" | "required" }
  | {
      candidates: (context: ToolDiscoveryContext) => string[];
      kind: "standardLocations";
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

export const resolveUserPath = (rawPath: string, homeDir = homedir()): string => {
  const trimmed = stripMatchingQuotes(rawPath.trim());
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homeDir, trimmed.slice(2));
  }
  return trimmed;
};

export const isExecutableFile = (candidate: string, platform: NodeJS.Platform = process.platform) =>
  Effect.tryPromise({
    try: async () => {
      const file = await stat(candidate);
      if (!file.isFile()) {
        return false;
      }
      if (platform !== "win32") {
        await access(candidate, constants.X_OK);
      }
      return true;
    },
    catch: (cause) => toHostPathStatError(cause, "toolDiscovery.isExecutableFile", candidate),
  }).pipe(
    Effect.catchTags({
      HostPathAccessError: () => Effect.succeed(false),
      HostPathNotFoundError: () => Effect.succeed(false),
    }),
  );

const executableName = (command: string, platform: NodeJS.Platform): string =>
  platform === "win32" ? `${command}.exe` : command;

const joinToolPath = (...segments: string[]): string => join(...segments);

const toolPathInDirectory = (
  context: Pick<ToolDiscoveryContext, "platform">,
  directory: string,
  command: string,
): string => joinToolPath(directory, executableName(command, context.platform));

const createToolDiscoveryContext = ({
  applicationsDir,
  bundledToolBinDir,
  homeDir,
  platform,
}: ToolDiscoveryPathOptions = {}): ToolDiscoveryContext => ({
  applicationsDir: applicationsDir ?? DEFAULT_MACOS_APPLICATIONS_DIR,
  ...(bundledToolBinDir === undefined ? {} : { bundledToolBinDir }),
  homeDir: homeDir ?? homedir(),
  platform: platform ?? process.platform,
});

const resolvePathCommand = (
  command: string,
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const resolved = systemCommands.resolveCommandPath?.(command, env);
    if (resolved !== undefined) {
      return yield* resolved.pipe(
        Effect.catchTag("HostPathAccessError", () => Effect.succeed(null)),
      );
    }
    const requiredError = yield* systemCommands
      .requiredCommandError(command)
      .pipe(Effect.catchTag("HostPathAccessError", () => Effect.succeed("unavailable")));
    return requiredError === null ? command : null;
  });

const describeCandidates = (candidates: string[]): string =>
  candidates.length > 0 ? candidates.join(", ") : "none configured";

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
          const resolvedOverride = resolveUserPath(rawOverride, context.homeDir);
          if (yield* isExecutableFile(resolvedOverride, context.platform)) {
            return resolvedOverride;
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

        case "bundledToolBin": {
          if (context.bundledToolBinDir === undefined) {
            break;
          }
          const candidate = toolPathInDirectory(
            context,
            resolveUserPath(context.bundledToolBinDir, context.homeDir),
            descriptor.command,
          );
          checked.push(`bundled tool location (${candidate})`);
          if (yield* isExecutableFile(candidate, context.platform)) {
            return candidate;
          }
          if (source.policy === "required") {
            return yield* Effect.fail(missingToolError(descriptor, checked, { candidate }));
          }
          break;
        }

        case "standardLocations": {
          const candidates = source.candidates(context);
          checked.push(`${source.label} (${describeCandidates(candidates)})`);
          for (const candidate of candidates) {
            if (yield* isExecutableFile(candidate, context.platform)) {
              return candidate;
            }
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

const pathOnlyTool = (command: string, installHint?: string): ToolDiscoveryDescriptor => ({
  command,
  displayName: command,
  installHint: installHint ?? `Install ${command} and ensure it is available on PATH.`,
  sources: [{ kind: "path" }],
});

export const BUN_TOOL_DESCRIPTOR = pathOnlyTool("bun");
export const GIT_TOOL_DESCRIPTOR = pathOnlyTool("git");
export const GITHUB_CLI_TOOL_DESCRIPTOR = pathOnlyTool("gh");
export const BEADS_TOOL_DESCRIPTOR = pathOnlyTool("bd");
export const DOLT_TOOL_DESCRIPTOR = pathOnlyTool("dolt");

export const OPENCODE_TOOL_DESCRIPTOR: ToolDiscoveryDescriptor = {
  command: "opencode",
  displayName: "OpenCode",
  installHint: "Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.",
  sources: [
    { kind: "environment", variable: "OPENDUCKTOR_OPENCODE_BINARY" },
    { kind: "bundledToolBin", policy: "required" },
    {
      candidates: (context) => [
        toolPathInDirectory(context, joinToolPath(context.homeDir, ".opencode", "bin"), "opencode"),
      ],
      kind: "standardLocations",
      label: "standard install locations",
    },
    { kind: "path" },
  ],
};

export const CODEX_TOOL_DESCRIPTOR: ToolDiscoveryDescriptor = {
  command: "codex",
  displayName: "Codex",
  installHint: "Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.",
  sources: [
    { kind: "environment", variable: "OPENDUCKTOR_CODEX_BINARY" },
    { kind: "bundledToolBin", policy: "required" },
    {
      candidates: (context) => {
        if (context.platform !== "darwin") {
          return [];
        }
        const appPath = ["Codex.app", "Contents", "Resources", "codex"];
        const applicationsDir = resolveUserPath(context.applicationsDir, context.homeDir);
        return [
          joinToolPath(applicationsDir, ...appPath),
          joinToolPath(context.homeDir, "Applications", ...appPath),
        ];
      },
      kind: "standardLocations",
      label: "standard install locations",
    },
    { kind: "path" },
  ],
};

export const TOOL_DISCOVERY_DESCRIPTORS: Record<ToolDiscoveryId, ToolDiscoveryDescriptor> = {
  beads: BEADS_TOOL_DESCRIPTOR,
  bun: BUN_TOOL_DESCRIPTOR,
  codex: CODEX_TOOL_DESCRIPTOR,
  dolt: DOLT_TOOL_DESCRIPTOR,
  git: GIT_TOOL_DESCRIPTOR,
  githubCli: GITHUB_CLI_TOOL_DESCRIPTOR,
  opencode: OPENCODE_TOOL_DESCRIPTOR,
};

export const createToolDiscoveryAdapter = ({
  env = process.env,
  options = {},
  systemCommands,
}: {
  env?: NodeJS.ProcessEnv;
  options?: ToolDiscoveryPathOptions;
  systemCommands: SystemCommandPort;
}): ToolDiscoveryPort => ({
  resolveToolPath(toolId) {
    return discoverToolPath(TOOL_DISCOVERY_DESCRIPTORS[toolId], systemCommands, env, options);
  },
});
