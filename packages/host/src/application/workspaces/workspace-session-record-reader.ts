import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitPort } from "../../ports/git-port";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export const createWorkspaceSessionRecordReader = ({
  settings,
  git,
  store,
}: {
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  git: Pick<GitPort, "canonicalizePath">;
  store: Pick<WorkspaceSessionStorePort, "get">;
}) => {
  const scopeFor = (workspaceId: string) =>
    Effect.gen(function* () {
      const config = yield* settings.getRepoConfig(workspaceId);
      const repoPath = yield* git.canonicalizePath(config.repoPath);
      return { workspaceId, repoPath };
    });
  const recordFor = (input: WorkspaceSessionRefInput) =>
    Effect.gen(function* () {
      const scope = yield* scopeFor(input.workspaceId);
      const ref = { ...scope, sessionId: input.sessionId };
      const session = yield* store.get(ref);
      return { ref, session };
    });

  return { scopeFor, recordFor };
};
