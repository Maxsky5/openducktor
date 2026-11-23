import type { ModelCatalogPreviewReader } from "../../application/runtimes/model-catalog-preview-service";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createAntigravityModelCatalogPreview } from "../antigravity/antigravity-model-catalog-preview";
import { createClaudeModelCatalogPreview } from "../claude/claude-model-catalog-preview";
import { createCodexModelCatalogPreview } from "../codex/codex-model-catalog-preview";
import { createOpenCodeModelCatalogPreview } from "../opencode/opencode-model-catalog-preview";

export const createNodeModelCatalogPreview = ({
  settingsConfig,
  toolDiscovery,
  readEnv,
  clientVersion,
}: {
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
  readEnv: () => NodeJS.ProcessEnv;
  clientVersion: string;
}): ModelCatalogPreviewReader => {
  const readClaude = createClaudeModelCatalogPreview({ settingsConfig, toolDiscovery, readEnv });
  const readCodex = createCodexModelCatalogPreview({
    settingsConfig,
    toolDiscovery,
    readEnv,
    clientVersion,
  });
  const readOpenCode = createOpenCodeModelCatalogPreview({
    settingsConfig,
    toolDiscovery,
    readEnv,
  });
  const readAntigravity = createAntigravityModelCatalogPreview({
    settingsConfig,
    toolDiscovery,
    readEnv,
  });
  return ({ repoPath, runtimeKind }) => {
    switch (runtimeKind) {
      case "claude":
        return readClaude(repoPath);
      case "codex":
        return readCodex(repoPath);
      case "opencode":
        return readOpenCode(repoPath);
      case "antigravity":
        return readAntigravity(repoPath);
    }
  };
};
