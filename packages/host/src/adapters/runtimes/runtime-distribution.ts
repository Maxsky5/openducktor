import { HostValidationError } from "../../effect/host-errors";

declare const hostRuntimeDistributionBrand: unique symbol;

type HostRuntimeDistributionBrand = {
  readonly [hostRuntimeDistributionBrand]: true;
};

export type SourceRuntimeDistribution = HostRuntimeDistributionBrand & {
  mode: "source";
  workspaceRoot: string;
};

export type ExecutableMcpLauncher = {
  kind: "executable";
  executablePath: string;
};

export type BunScriptMcpLauncher = {
  kind: "bunScript";
  bunExecutablePath: string;
  scriptPath: string;
};

export type ArtifactMcpLauncher = ExecutableMcpLauncher | BunScriptMcpLauncher;

export type ArtifactRuntimeDistribution = HostRuntimeDistributionBrand & {
  mode: "artifact";
  mcpLauncher: ArtifactMcpLauncher;
  bundledBinDir?: string;
};

export type HostRuntimeDistribution = SourceRuntimeDistribution | ArtifactRuntimeDistribution;

const assertNonEmpty = (value: string, field: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HostValidationError({
      field,
      message: `${field} cannot be empty.`,
    });
  }
  return trimmed;
};

export const createSourceRuntimeDistribution = (workspaceRoot: string): SourceRuntimeDistribution =>
  ({
    mode: "source",
    workspaceRoot: assertNonEmpty(workspaceRoot, "workspaceRoot"),
  }) as SourceRuntimeDistribution;

const unsupportedArtifactMcpLauncher = (launcher: never): never => {
  const kind = (launcher as { kind?: unknown }).kind;
  throw new HostValidationError({
    field: "mcpLauncher.kind",
    message: `Unsupported MCP launcher kind: ${String(kind)}`,
  });
};

const createArtifactMcpLauncher = (launcher: ArtifactMcpLauncher): ArtifactMcpLauncher => {
  switch (launcher.kind) {
    case "executable":
      return {
        kind: "executable",
        executablePath: assertNonEmpty(launcher.executablePath, "mcpLauncher.executablePath"),
      };
    case "bunScript":
      return {
        kind: "bunScript",
        bunExecutablePath: assertNonEmpty(
          launcher.bunExecutablePath,
          "mcpLauncher.bunExecutablePath",
        ),
        scriptPath: assertNonEmpty(launcher.scriptPath, "mcpLauncher.scriptPath"),
      };
  }

  return unsupportedArtifactMcpLauncher(launcher);
};

export const createArtifactRuntimeDistribution = ({
  bundledBinDir,
  mcpLauncher,
}: {
  bundledBinDir?: string;
  mcpLauncher: ArtifactMcpLauncher;
}): ArtifactRuntimeDistribution => {
  return {
    mode: "artifact",
    mcpLauncher: createArtifactMcpLauncher(mcpLauncher),
    ...(bundledBinDir === undefined
      ? {}
      : { bundledBinDir: assertNonEmpty(bundledBinDir, "bundledBinDir") }),
  } as ArtifactRuntimeDistribution;
};
