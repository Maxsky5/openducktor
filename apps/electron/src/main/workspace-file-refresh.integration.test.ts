import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createFilesystemAdapter } from "../../../../packages/host/src/adapters/filesystem/filesystem-adapter";
import { createWorkspaceTreeRefresh } from "../../../../packages/host/src/application/filesystem/workspace-tree-refresh";
import {
  refreshWorkspaceFileQueries,
  workspaceFileTreeQueryOptions,
} from "@openducktor/frontend-core/queries/filesystem";
import { scheduleWorkspaceRefresh } from "@openducktor/frontend-core/queries/workspace-refresh";
import type { WorkspaceFileTreeRefreshInput } from "@openducktor/contracts";
import { createDeferred } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";

test("a new branch reads its own host view while the previous sweep's Git callback is pending", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "odt-query-tree-"));
  const root = await realpath(temporaryRoot);
  let branch = "main";
  const tree = createWorkspaceTreeRefresh(createFilesystemAdapter(), {
    getFileTreeContext: () =>
      Effect.succeed({
        rootPath: root,
        gitDirectory: path.join(root, ".git"),
        branch,
        head: branch,
        targetBranch: null,
        targetRevision: null,
        indexVersion: "index",
        sparsePolicy: "policy",
      }),
    getRepositoryRoot: () => Effect.succeed(root),
    getStatus: () => Effect.succeed([]),
    listChangedFiles: () => Effect.succeed([]),
    isGitRepository: () => Effect.succeed(true),
    listFiles: () => Effect.succeed([{ path: `${branch}.txt`, kind: "file" }]),
    listFileRegions: () => Effect.succeed([]),
  });
  const readComplete = createDeferred<void>();
  const gitStarted = createDeferred<void>();
  const releaseGit = createDeferred<void>();
  // The test host reads the tree through the real host refresh. Other host commands fail.
  const { queryClient: client } = createTestClientConnection({
    client: {
      filesystemRefreshTree: async (input: WorkspaceFileTreeRefreshInput) => {
        const result = await Effect.runPromise(tree(input));
        if (input.mode === "incremental") readComplete.resolve();
        return result;
      },
    },
  });
  let sweep: Promise<void> | undefined;
  try {
    const main = workspaceFileTreeQueryOptions(root, null, "main");
    await client.fetchQuery(main);
    sweep = scheduleWorkspaceRefresh(
      client,
      root,
      "incremental",
      async () => {
        await client.fetchQuery(workspaceFileTreeQueryOptions(root, null, branch));
      },
      {
        consumer: client,
        context: "main",
        priority: 2,
        mayFetch: false,
        run: async () => {
          gitStarted.resolve();
          await releaseGit.promise;
        },
      },
    );
    await Promise.all([readComplete.promise, gitStarted.promise]);
    await client.fetchQuery(main);
    branch = "other";
    const full = refreshWorkspaceFileQueries(client, root, "full");
    expect(full).toBe(sweep);
    const selected = await client.fetchQuery(workspaceFileTreeQueryOptions(root, null, "other"));
    expect(selected.context?.branch).toBe("other");
    expect(selected.entries.map((entry) => entry.path)).toEqual(["other.txt"]);
  } finally {
    releaseGit.resolve();
    try {
      await sweep;
    } finally {
      client.clear();
      await Effect.runPromise(tree.dispose());
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
});
