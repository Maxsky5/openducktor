import type { WorkspaceRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostValidationError } from "../../../effect/host-errors";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";

export const getScopedRepoConfig = (
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">,
  scope: WorkspaceRef,
) =>
  Effect.gen(function* () {
    const config = yield* settings.getRepoConfig(scope.workspaceId);
    if (
      config.workspaceId !== scope.workspaceId ||
      normalizePathForComparison(config.repoPath) !== normalizePathForComparison(scope.repoPath)
    )
      return yield* new HostValidationError({
        field: "workspaceId",
        message:
          "The workspace no longer matches this repository. Reload the workspace before retrying.",
      });
    return config;
  });
