import type { WorkspaceRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { workspaceMatchesScope, workspaceScopeMismatch } from "../../domain/workspace-scope";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

export const getScopedRepoConfig = (
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">,
  scope: WorkspaceRef,
) =>
  Effect.gen(function* () {
    const config = yield* settings.getRepoConfig(scope.workspaceId);
    if (!workspaceMatchesScope(scope, config)) return yield* workspaceScopeMismatch();
    return config;
  });
