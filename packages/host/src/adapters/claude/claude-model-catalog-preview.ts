import { query } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { resolveSavedRuntimeExecutableConfig } from "../../application/runtimes/saved-runtime-executable";
import { toHostOperationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { loadClaudeModelCatalog } from "./claude-agent-sdk-catalog";

export const createClaudeModelCatalogPreview =
  ({
    settingsConfig,
    toolDiscovery,
    processEnv,
  }: {
    settingsConfig: SettingsConfigPort;
    toolDiscovery: ToolDiscoveryPort;
    processEnv: NodeJS.ProcessEnv;
  }) =>
  (repoPath: string) =>
    Effect.gen(function* () {
      const { executablePath } = yield* resolveSavedRuntimeExecutableConfig({
        kind: "claude",
        settingsConfig,
        toolDiscovery,
      });
      return yield* Effect.tryPromise({
        try: () => loadClaudeModelCatalog(repoPath, processEnv, executablePath, query),
        catch: (cause) => toHostOperationError(cause, "claudeModelCatalogPreview.read"),
      });
    });
