import { posix, win32 } from "node:path";
import { normalizeUserPathInput, resolveNormalizedUserPath } from "@openducktor/path-support";
import type { ToolDiscoveryId, ToolDiscoverySourceCategory } from "../../ports/tool-discovery-port";

export type ToolDiscoveryPathOptions = {
  applicationsDir?: string;
  bundledToolBinDirs?: Partial<Record<ToolDiscoveryId, string>>;
  homeDir?: string;
  platform?: NodeJS.Platform;
  providedToolPaths?: Partial<Record<ToolDiscoveryId, string>>;
};

export type ToolDiscoveryContext = {
  applicationsDir: string;
  bundledToolBinDirs: Partial<Record<ToolDiscoveryId, string>>;
  homeDir: string;
  platform: NodeJS.Platform;
  providedToolPaths: Partial<Record<ToolDiscoveryId, string>>;
};

export type ToolDiscoverySource =
  | {
      directories: (context: ToolDiscoveryContext) => (string | undefined)[];
      displayLabel?: string;
      kind: "searchDirectories";
      label?: string;
      requiredMissingMessage?: (input: {
        descriptor: ToolDiscoveryDescriptor;
        directories: readonly string[];
      }) => string;
      sourceCategory?: ToolDiscoverySourceCategory;
      policy: "candidate" | "required";
    }
  | {
      candidates: (context: ToolDiscoveryContext) => string[];
      displayLabel?: string;
      kind: "candidateFiles";
      label: string;
      sourceCategory?: ToolDiscoverySourceCategory;
    };

export type ToolDiscoveryDescriptor = {
  command: string;
  displayName: string;
  installHint: string;
  overrideVariable: string;
  sources: ToolDiscoverySource[];
};

export const DEFAULT_MACOS_APPLICATIONS_DIR = "/Applications";

export const joinToolPath = (
  context: Pick<ToolDiscoveryContext, "platform">,
  ...segments: string[]
): string => (context.platform === "win32" ? win32.join(...segments) : posix.join(...segments));

export const resolveUserPathForContext = (rawPath: string, context: ToolDiscoveryContext): string =>
  resolveNormalizedUserPath(normalizeUserPathInput(rawPath), {
    homeDir: context.homeDir,
    joinHomePath: (homeDir, relativePath) => joinToolPath(context, homeDir, relativePath),
  });

export const describeLocations = (locations: string[]): string =>
  locations.length > 0 ? locations.join(", ") : "none configured";

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

const bundledElectronResourceSource = (toolId: ToolDiscoveryId): ToolDiscoverySource => ({
  directories: (context) => [context.bundledToolBinDirs[toolId]],
  displayLabel: "Bundled with OpenDucktor",
  kind: "searchDirectories",
  label: "bundled Electron resource directory",
  policy: "required",
  requiredMissingMessage: ({ descriptor, directories }) =>
    `Packaged Electron ${descriptor.displayName} sidecar is missing or invalid: expected ${
      descriptor.command
    } in ${describeLocations([...directories])}. This is an OpenDucktor packaging defect.`,
  sourceCategory: "bundled_electron_resource",
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
  sources: [bundledElectronResourceSource("beads")],
});
const DOLT_TOOL_DESCRIPTOR = commandTool({
  command: "dolt",
  displayName: "Dolt",
  overrideVariable: "OPENDUCKTOR_DOLT_PATH",
  sources: [bundledElectronResourceSource("dolt")],
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

export const TOOL_DISCOVERY_DESCRIPTORS: Record<ToolDiscoveryId, ToolDiscoveryDescriptor> = {
  beads: BEADS_TOOL_DESCRIPTOR,
  bun: BUN_TOOL_DESCRIPTOR,
  codex: CODEX_TOOL_DESCRIPTOR,
  dolt: DOLT_TOOL_DESCRIPTOR,
  git: GIT_TOOL_DESCRIPTOR,
  githubCli: GITHUB_CLI_TOOL_DESCRIPTOR,
  opencode: OPENCODE_TOOL_DESCRIPTOR,
};
