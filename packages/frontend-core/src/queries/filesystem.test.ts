import { describe, expect, test } from "bun:test";
import type {
  WorkspaceFileTreeRefreshResult,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  filesystemQueryKeys,
  workspaceFilePreviewQueryOptions,
  workspaceFileTreeQueryOptions,
  workspaceTextFileQueryOptions,
  workspaceTextFileWriteMutationOptions,
} from "./filesystem";

const saveTextFile = (queryClient: QueryClient, input: WorkspaceTextFileWriteInput) =>
  queryClient
    .getMutationCache()
    .build(queryClient, workspaceTextFileWriteMutationOptions(queryClient))
    .execute(input);

const textResult = (rootPath: string, relativePath: string): WorkspaceTextFileWriteResult => ({
  kind: "text",
  rootPath,
  relativePath,
  contents: "text",
  size: 4,
  mtimeMs: 1,
  revision: "revision-1",
});

test.each([".png", "nested/.PNG", "nested.png/jpg", "picture.avif"])(
  "the preview reads saved text for %s",
  async (relativePath) => {
    const rootPath = "/tmp";
    const scope = { kind: "local" } as const;
    const initial = textResult(rootPath, relativePath);
    const { queryClient } = createTestClientConnection({
      client: {
        filesystemReadTextFile: async () => initial,
        filesystemWriteTextFile: async ({ contents }) => ({
          ...initial,
          contents,
          size: contents.length,
          mtimeMs: 2,
          revision: "revision-2",
        }),
      },
    });
    try {
      const preview = workspaceFilePreviewQueryOptions(rootPath, relativePath, scope);
      await queryClient.fetchQuery(preview);
      const saved = await saveTextFile(queryClient, {
        rootPath,
        relativePath,
        scope,
        contents: "saved",
        revision: initial.revision,
      });

      expect(queryClient.getQueryData(preview.queryKey)).toEqual(saved);
    } finally {
      queryClient.clear();
    }
  },
);

describe("workspaceFileTreeQueryOptions", () => {
  test("passes the target branch to the filesystem tree host read", async () => {
    const inputs: Array<Parameters<HostClient["filesystemRefreshTree"]>[0]> = [];
    const { queryClient } = createTestClientConnection({
      client: {
        filesystemRefreshTree: async (
          input: Parameters<HostClient["filesystemRefreshTree"]>[0],
        ): Promise<WorkspaceFileTreeRefreshResult> => {
          inputs.push(input);
          return {
            kind: "snapshot",
            rootPath: "/repo",
            context: {
              rootPath: "/repo",
              gitDirectory: "/repo/.git",
              branch: "main",
              head: "head",
              targetBranch: "origin/main",
              targetRevision: "target",
              indexVersion: "index",
              sparsePolicy: "",
            },
            cursor: { viewId: "view", revision: 0 },
            entries: [],
          };
        },
      },
    });

    await queryClient.fetchQuery(workspaceFileTreeQueryOptions("/repo", "origin/main"));

    expect(inputs).toEqual([
      {
        rootPath: "/repo",
        targetBranch: "origin/main",
        mode: "full",
        refreshId: expect.any(String),
      },
    ]);
  });

  for (const access of [undefined, "local"] as const) {
    test(`updates the exact text cache and invalidates only the workspace tree after save, access=${access}`, async () => {
      const { queryClient } = createTestClientConnection({
        client: {
          filesystemWriteTextFile: async (input) => ({
            kind: "text",
            ...input,
            size: input.contents.length,
            mtimeMs: 2,
            revision: "revision-2",
          }),
        },
      });
      const input: WorkspaceTextFileWriteInput = {
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "saved",
        revision: "revision-1",
      };
      if (access) input.scope = { kind: access };
      const otherFileKey = filesystemQueryKeys.textFile(
        "/repo",
        "file.txt",
        access ? undefined : { kind: "local" },
      );
      const treeKey = filesystemQueryKeys.treeRoot("/repo");
      const unrelatedKey = filesystemQueryKeys.treeRoot("/other");
      queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
      queryClient.setQueryData(unrelatedKey, { rootPath: "/other", entries: [] });
      queryClient.setQueryData(otherFileKey, "other access mode");

      const saved = await saveTextFile(queryClient, input);

      expect(
        queryClient.getQueryData<WorkspaceTextFileWriteResult>(
          filesystemQueryKeys.textFile("/repo", "file.txt", access ? { kind: access } : undefined),
        ),
      ).toEqual(saved);
      expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
      expect(queryClient.getQueryData(otherFileKey)).toBe("other access mode");
    });
  }

  test("leaves the query cache unchanged when the write fails", async () => {
    const key = filesystemQueryKeys.textFile("/repo", "file.txt");
    const baseline: WorkspaceTextFileReadResult = {
      kind: "text",
      rootPath: "/repo",
      relativePath: "file.txt",
      contents: "before",
      size: 6,
      mtimeMs: 1,
      revision: "revision-1",
    };
    const { queryClient } = createTestClientConnection({
      client: {
        filesystemWriteTextFile: async () => {
          throw new Error("The file changed after it was loaded.");
        },
      },
    });
    queryClient.setQueryData(key, baseline);

    await expect(
      saveTextFile(queryClient, {
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "draft",
        revision: "revision-1",
      }),
    ).rejects.toThrow("The file changed after it was loaded.");
    expect(queryClient.getQueryData(key)).toEqual(baseline);
  });
});

describe("workspace session file context", () => {
  const chat = { kind: "chat" as const, session: { workspaceId: "workspace", sessionId: "chat" } };

  test("tree and file reads send the session and keep entries under their directory keys", async () => {
    const treeInputs: Array<Parameters<HostClient["filesystemRefreshTree"]>[0]> = [];
    const readInputs: Array<Parameters<HostClient["filesystemReadTextFile"]>[0]> = [];
    const { queryClient } = createTestClientConnection({
      client: {
        filesystemRefreshTree: async (input) => {
          treeInputs.push(input);
          return {
            kind: "snapshot",
            rootPath: "/worktree",
            context: {
              rootPath: "/worktree",
              gitDirectory: "/repo/.git/worktrees/worktree",
              branch: "main",
              head: "head",
              targetBranch: null,
              targetRevision: null,
              indexVersion: "index",
              sparsePolicy: "",
            },
            cursor: { viewId: "view", revision: 0 },
            entries: [],
          };
        },
        filesystemReadTextFile: async (input) => {
          readInputs.push(input);
          return textResult(input.rootPath, input.relativePath);
        },
      },
    });
    const tree = workspaceFileTreeQueryOptions("/worktree", null, undefined, chat);
    const text = workspaceTextFileQueryOptions("/worktree", "a.ts", chat);
    const preview = workspaceFilePreviewQueryOptions("/worktree", "b.md", chat);

    await queryClient.fetchQuery(tree);
    await queryClient.fetchQuery(text);
    await queryClient.fetchQuery(preview);

    expect(treeInputs).toEqual([
      {
        rootPath: "/worktree",
        scope: chat,
        mode: "full",
        refreshId: expect.any(String),
      },
    ]);
    expect(readInputs).toEqual([
      { rootPath: "/worktree", relativePath: "a.ts", scope: chat },
      { rootPath: "/worktree", relativePath: "b.md", scope: chat },
    ]);
    expect(tree.queryKey).not.toEqual(workspaceFileTreeQueryOptions("/worktree", null).queryKey);
    expect(text.queryKey).not.toEqual(filesystemQueryKeys.textFile("/worktree", "a.ts"));
    expect(tree.queryKey.slice(0, 3)).toEqual([...filesystemQueryKeys.treeRoot("/worktree")]);
    expect(text.queryKey.slice(0, 3)).toEqual([...filesystemQueryKeys.textFileRoot("/worktree")]);
  });

  test("a save sends the session and updates the text entry that the chat reads", async () => {
    const writes: WorkspaceTextFileWriteInput[] = [];
    const { queryClient } = createTestClientConnection({
      client: {
        filesystemWriteTextFile: async (input) => {
          writes.push(input);
          return { ...textResult(input.rootPath, input.relativePath), contents: input.contents };
        },
      },
    });
    const unscopedKey = filesystemQueryKeys.textFile("/worktree", "a.ts");
    queryClient.setQueryData(unscopedKey, "unscoped");

    await saveTextFile(queryClient, {
      rootPath: "/worktree",
      relativePath: "a.ts",
      contents: "saved",
      revision: "revision-1",
      scope: chat,
    });

    expect(writes[0]?.scope).toEqual(chat);
    expect(
      queryClient.getQueryData<WorkspaceTextFileReadResult>(
        workspaceTextFileQueryOptions("/worktree", "a.ts", chat).queryKey,
      ),
    ).toMatchObject({ contents: "saved" });
    expect(queryClient.getQueryData(unscopedKey)).toBe("unscoped");
  });
});
