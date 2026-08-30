import type { ToolExecutableSourceCategory } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type { HostDependencyError, HostValidationError } from "../effect/host-errors";

export const TOOL_DISCOVERY_IDS = [
  "bun",
  "claude",
  "codex",
  "git",
  "githubCli",
  "opencode",
] as const;

export type ToolDiscoveryId = (typeof TOOL_DISCOVERY_IDS)[number];

export const isToolDiscoveryId = (value: string): value is ToolDiscoveryId =>
  TOOL_DISCOVERY_IDS.some((toolId) => toolId === value);

export type ToolDiscoveryDetails = {
  readonly directories?: readonly string[];
  readonly executablePath?: string;
  readonly requiredSource?: boolean;
  readonly resolvedOverride?: string;
  readonly resolvedProvidedPath?: string;
};

export type ToolDiscoveryError =
  | HostDependencyError<ToolDiscoveryDetails>
  | HostValidationError<ToolDiscoveryDetails>;

export type ToolDiscoverySourceCategory = Exclude<ToolExecutableSourceCategory, "unavailable">;

export type ResolvedTool = {
  displayLabel: string;
  path: string;
  sourceCategory: ToolDiscoverySourceCategory;
};

export type ToolDiscoveryPort = {
  discoverTool(toolId: ToolDiscoveryId): Effect.Effect<ResolvedTool, ToolDiscoveryError>;
  resolveTool(toolId: ToolDiscoveryId): Effect.Effect<ResolvedTool, ToolDiscoveryError>;
  resolveToolPath(toolId: ToolDiscoveryId): Effect.Effect<string, ToolDiscoveryError>;
  validateToolPath(
    toolId: ToolDiscoveryId,
    executablePath: string,
  ): Effect.Effect<ResolvedTool, ToolDiscoveryError>;
};

export const discoverToolFresh = (port: ToolDiscoveryPort, toolId: ToolDiscoveryId) =>
  port.discoverTool(toolId);

export const validateExactToolPath = (
  port: ToolDiscoveryPort,
  toolId: ToolDiscoveryId,
  executablePath: string,
) => port.validateToolPath(toolId, executablePath);

export class ToolDiscoveryPortTag extends Context.Tag("@openducktor/host/ToolDiscoveryPort")<
  ToolDiscoveryPortTag,
  ToolDiscoveryPort
>() {}
