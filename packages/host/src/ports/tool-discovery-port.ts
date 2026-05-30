import { Context, type Effect } from "effect";
import type {
  HostDependencyError,
  HostPathAccessError,
  HostValidationError,
} from "../effect/host-errors";

export type ToolDiscoveryId = "beads" | "bun" | "codex" | "dolt" | "git" | "githubCli" | "opencode";

export type ToolDiscoveryError = HostDependencyError | HostPathAccessError | HostValidationError;

export type ToolDiscoveryPort = {
  resolveToolPath(toolId: ToolDiscoveryId): Effect.Effect<string, ToolDiscoveryError>;
};

export class ToolDiscoveryPortTag extends Context.Tag("@openducktor/host/ToolDiscoveryPort")<
  ToolDiscoveryPortTag,
  ToolDiscoveryPort
>() {}
