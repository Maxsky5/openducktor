import type { WorkspaceCatalogRepo } from "../../ports/settings-config-port";
import {
  applyAutopilotSettingsPatch,
  applyCustomAgentRoleEdits,
  applyGlobalSettingsPatch,
  applyWorkspaceSettingsPatch,
  globalConfigSchema,
  type GlobalConfig,
  type SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import { ensureRepoPathAvailable } from "./workspace-settings-model";
import { configValidationError } from "../../config/config-validation-message";
import { HostValidationError } from "../../effect/host-errors";

/** Rebase validated field edits on the transaction's current workspace records. */
export const applySettingsEdits = (
  current: GlobalConfig,
  input: SettingsSnapshotSaveInput,
  catalog: readonly WorkspaceCatalogRepo[],
): GlobalConfig => {
  try {
    const candidate = { ...applyGlobalSettingsPatch(current, input.global, "request") };
    candidate.workspaces = { ...current.workspaces };
    for (const [id, patch] of Object.entries(input.workspaces ?? {})) {
      const existing = current.workspaces[id];
      if (!existing || existing.closed || existing.removal)
        throw new HostValidationError({
          field: "workspaces",
          message: `Workspace ${id} is no longer open. Reload settings and retry.`,
        });
      if (existing.repoPath !== patch.expectedRepoPath)
        throw new HostValidationError({
          field: "repoPath",
          message: `Workspace ${id} repository path changed. Reload settings and retry.`,
        });
      candidate.workspaces[id] = applyWorkspaceSettingsPatch(existing, patch);
    }
    for (const [id, patch] of Object.entries(input.workspaces ?? {})) {
      if (patch.repoPath === undefined || patch.repoPath === patch.expectedRepoPath) continue;
      ensureRepoPathAvailable(
        {
          workspaces: {
            ...Object.fromEntries(catalog.map((workspace) => [workspace.workspaceId, workspace])),
            ...candidate.workspaces,
          },
        },
        patch.repoPath,
        id,
      );
    }
    candidate.customAgentRoles = applyCustomAgentRoleEdits(
      current.customAgentRoles,
      input.customAgentRoles,
      "request",
    );
    candidate.autopilot = applyAutopilotSettingsPatch(current.autopilot, input.autopilot);
    return globalConfigSchema.parse(candidate);
  } catch (cause) {
    if (cause instanceof HostValidationError) throw cause;
    throw configValidationError(cause);
  }
};
