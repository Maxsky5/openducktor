import { Context, type Effect } from "effect";
import type { HostDependencyError, HostValidationError } from "../effect/host-errors";

export const TOOL_DISCOVERY_IDS = [
  "beads",
  "bun",
  "codex",
  "dolt",
  "git",
  "githubCli",
  "opencode",
] as const;

export type ToolDiscoveryId = (typeof TOOL_DISCOVERY_IDS)[number];

export const isToolDiscoveryId = (value: string): value is ToolDiscoveryId =>
  (TOOL_DISCOVERY_IDS as readonly string[]).includes(value);

export type ToolDiscoveryError = HostDependencyError | HostValidationError;

export type ToolDiscoveryPort = {
  resolveToolPath(toolId: ToolDiscoveryId): Effect.Effect<string, ToolDiscoveryError>;
};

export class ToolDiscoveryPortTag extends Context.Tag("@openducktor/host/ToolDiscoveryPort")<
  ToolDiscoveryPortTag,
  ToolDiscoveryPort
>() {}
