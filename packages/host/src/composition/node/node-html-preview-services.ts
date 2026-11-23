import { tmpdir } from "node:os";
import { createNodeHtmlPreviewFilePort } from "../../adapters/node/filesystem-html-preview-file-port";
import { createNodeSessionHtmlPreviewStore } from "../../adapters/node/filesystem-session-html-preview-store";
import type { ManagedCallerResolver } from "../../application/agent-sessions/managed-caller-resolver";
import { createSessionHtmlPreviewService } from "../../application/html-previews/session-html-preview-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import type { OpenDucktorConfigDir } from "../../config/openducktor-config-dir";
import { createSessionHtmlPreviewCommandHandlers } from "../../interface/commands/session-html-preview-command-handlers";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

/** Composes the workspace-folder HTML preview store, service, and host command handlers. */
export const createNodeHtmlPreviewServices = (
  configDir: OpenDucktorConfigDir,
  managedCallers: ManagedCallerResolver,
  settings: {
    workspaceSettingsService: WorkspaceSettingsService;
    settingsConfig: SettingsConfigPort;
  },
) => {
  const store = createNodeSessionHtmlPreviewStore({ configDir: configDir.root });
  const service = createSessionHtmlPreviewService({
    store,
    filePort: createNodeHtmlPreviewFilePort({ blockedRoots: [configDir.root] }),
    managedCallers,
    workspaceSettingsService: settings.workspaceSettingsService,
    settingsConfig: settings.settingsConfig,
    tempDir: tmpdir(),
  });
  return {
    store,
    service,
    handlers: createSessionHtmlPreviewCommandHandlers(service),
  };
};
