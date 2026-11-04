import { type RepoConfig, repoConfigSchema } from "@openducktor/contracts";
import type { z } from "zod";

/**
 * A parsed workspace config with the required fields set. A test passes only the fields that it
 * checks.
 */
export const repoConfigFixture = (
  overrides: Partial<z.input<typeof repoConfigSchema>> = {},
): RepoConfig =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultTargetBranch: { remote: "origin", branch: "main" },
    ...overrides,
  });
