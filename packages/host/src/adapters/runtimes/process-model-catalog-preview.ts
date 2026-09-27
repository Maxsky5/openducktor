import { Effect } from "effect";
import type { ModelCatalogPreviewReader } from "../../application/runtimes/model-catalog-preview-service";
import { HostOperationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createClaudeModelCatalogPreview } from "../claude/claude-model-catalog-preview";
import { createCodexModelCatalogPreview } from "../codex/codex-model-catalog-preview";
import { createOpenCodeModelCatalogPreview } from "../opencode/opencode-model-catalog-preview";

export const createNodeModelCatalogPreview = ({
  settingsConfig,
  toolDiscovery,
  processEnv,
  processPathError,
  clientVersion,
}: {
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
  processEnv: NodeJS.ProcessEnv;
  processPathError: string | null;
  clientVersion: string;
}): ModelCatalogPreviewReader => {
  const readClaude = createClaudeModelCatalogPreview({
    settingsConfig,
    toolDiscovery,
    processEnv,
  });
  const readCodex = createCodexModelCatalogPreview({
    settingsConfig,
    toolDiscovery,
    processEnv,
    clientVersion,
  });
  const readOpenCode = createOpenCodeModelCatalogPreview({
    settingsConfig,
    toolDiscovery,
    processEnv,
  });
  return ({ repoPath, runtimeKind }) => {
    if (processPathError) {
      return Effect.fail(
        new HostOperationError({
          operation: "modelCatalogPreview.resolveEnvironment",
          message: `Cannot load ${runtimeKind} models because the user PATH is unavailable. ${processPathError}`,
        }),
      );
    }
    switch (runtimeKind) {
      case "claude":
        return readClaude(repoPath);
      case "codex":
        return readCodex(repoPath);
      case "opencode":
        return readOpenCode(repoPath);
    }
  };
};
