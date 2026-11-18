import { Effect } from "effect";
import {
  createWorkspaceSessionCreationFacts,
  type WorkspaceSessionNamingDependencies,
} from "../application/workspaces/workspace-session-naming";
import type { NamingService } from "../application/naming/naming-service";
import { createGitPortTestDouble, unexpectedEffectCall } from "./service-test-doubles";

/** A naming service for a workspace without a naming model: it never calls a model. */
export const disabledNamingService: NamingService = {
  generate: () => Effect.succeed({ kind: "disabled" }),
};

export const createNamingTestDependencies = (
  overrides: Partial<WorkspaceSessionNamingDependencies> = {},
): WorkspaceSessionNamingDependencies => ({
  facts: createWorkspaceSessionCreationFacts(),
  service: disabledNamingService,
  settings: { getRepoConfig: unexpectedEffectCall("workspace settings", "getRepoConfig") },
  git: createGitPortTestDouble({}),
  ...overrides,
});
