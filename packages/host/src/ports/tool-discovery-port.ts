import type { ToolExecutableSourceCategory } from "@openducktor/contracts";
import { Context, Effect } from "effect";
import { HostDependencyError, type HostValidationError } from "../effect/host-errors";

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
  (TOOL_DISCOVERY_IDS as readonly string[]).includes(value);

export type ToolDiscoveryError = HostDependencyError | HostValidationError;

export type ToolDiscoverySourceCategory = Exclude<ToolExecutableSourceCategory, "unavailable">;

export type ResolvedTool = {
  displayLabel: string;
  path: string;
  sourceCategory: ToolDiscoverySourceCategory;
};

export type ToolDiscoveryPort = {
  discoverTool?(toolId: ToolDiscoveryId): Effect.Effect<ResolvedTool, ToolDiscoveryError>;
  resolveTool(toolId: ToolDiscoveryId): Effect.Effect<ResolvedTool, ToolDiscoveryError>;
  resolveToolPath(toolId: ToolDiscoveryId): Effect.Effect<string, ToolDiscoveryError>;
  validateToolPath?(
    toolId: ToolDiscoveryId,
    executablePath: string,
  ): Effect.Effect<ResolvedTool, ToolDiscoveryError>;
};

export const discoverToolFresh = (port: ToolDiscoveryPort, toolId: ToolDiscoveryId) =>
  port.discoverTool
    ? port.discoverTool(toolId)
    : Effect.fail(
        new HostDependencyError({
          dependency: toolId,
          operation: "toolDiscovery.discoverToolFresh",
          message: `Fresh discovery is not configured for ${toolId}.`,
        }),
      );

export const validateExactToolPath = (
  port: ToolDiscoveryPort,
  toolId: ToolDiscoveryId,
  executablePath: string,
) =>
  port.validateToolPath
    ? port.validateToolPath(toolId, executablePath)
    : Effect.fail(
        new HostDependencyError({
          dependency: toolId,
          operation: "toolDiscovery.validateExactToolPath",
          message: `Exact-path validation is not configured for ${toolId}: ${executablePath}`,
          details: { executablePath },
        }),
      );

export class ToolDiscoveryPortTag extends Context.Tag("@openducktor/host/ToolDiscoveryPort")<
  ToolDiscoveryPortTag,
  ToolDiscoveryPort
>() {}
