import { describe, expect, test } from "bun:test";
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

    expect(request.cacheKey).toBe("/repo\0");
    expect("workspaceId" in request.options).toBe(false);
  });

  test("uses resolved workspace ids when the requested workspace id is blank", async () => {
    const request = await Effect.runPromise(
      createResolver({ resolvedWorkspaceId: " workspace-from-config " })("/repo", {
        workspaceId: "   ",
      }),
    );

    expect(request.cacheKey).toBe("/repo\0workspace-from-config");
    expect(request.options.workspaceId).toBe("workspace-from-config");
  });
});
