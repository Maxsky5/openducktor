import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createBeadsCliContextRequestResolver } from "./beads-cli-context-request";

const createResolver = ({
  resolvedWorkspaceId = null,
}: {
  resolvedWorkspaceId?: string | null | undefined;
} = {}) =>
  createBeadsCliContextRequestResolver({
    isClosing: () => false,
    processEnv: { OPENDUCKTOR_CONFIG_DIR: "/config" },
    resolveBeadsToolPaths: () => Effect.succeed({ beads: "bd" }),
    resolveSharedDoltToolPaths: () => Effect.succeed({ dolt: "dolt" }),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed(resolvedWorkspaceId),
  });

describe("createBeadsCliContextRequestResolver", () => {
  test("omits blank requested workspace ids from forwarded options", async () => {
    const request = await Effect.runPromise(createResolver()("/repo", { workspaceId: "   " }));

    expect(request.cacheKey).toBe("repo:/repo");
    expect("workspaceId" in request.options).toBe(false);
    expect(request.repoPath).toBe("/repo");
  });

  test("uses resolved workspace ids when the requested workspace id is blank", async () => {
    const request = await Effect.runPromise(
      createResolver({ resolvedWorkspaceId: " workspace-from-config " })("/repo", {
        workspaceId: "   ",
      }),
    );

    expect(request.cacheKey).toBe("workspace:workspace-from-config");
    expect(request.options.workspaceId).toBe("workspace-from-config");
    expect(request.repoPath).toBe("/repo");
  });

  test("keys repo-scoped contexts by canonical repository identity", async () => {
    const repoPath = await mkdtemp(path.join(tmpdir(), "odt-beads-context-cache-"));
    try {
      const spelledPath = path.join(repoPath, ".");
      const [first, second] = await Effect.runPromise(
        Effect.all([createResolver()(repoPath), createResolver()(spelledPath)]),
      );

      expect(first.cacheKey).toBe(second.cacheKey);
      expect(first.repoPath).toBe(second.repoPath);
      expect(first.cacheKey).toBe(`repo:${first.repoPath}`);
    } finally {
      await rm(repoPath, { force: true, recursive: true });
    }
  });
});
