import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type {
  WorkspaceFileTreeRefreshResult,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  filesystemQueryKeys,
  workspaceFilePreviewQueryOptions,
  workspaceFileTreeQueryOptions,
  workspaceTextFileQueryOptions,
  workspaceTextFileWriteMutationOptions,
} from "./filesystem";

const createHostWrapper = (client: Partial<HostClient>) => {
  const connection = createTestClientConnection({ client });
  return ({ children }: PropsWithChildren): ReactElement =>
    createElement(ClientConnectionProvider, { connection }, children);
};

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
      const wrapper = createHostWrapper({
        filesystemWriteTextFile: async (
          input: WorkspaceTextFileWriteInput,
        ): Promise<WorkspaceTextFileWriteResult> => ({
          kind: "text",
          ...input,
          size: input.contents.length,
          mtimeMs: 2,
          revision: "revision-2",
        }),
      });
      const { result } = renderHook(
        () => {
          const queryClient = useQueryClient();
          return {
            queryClient,
            mutation: useMutation(workspaceTextFileWriteMutationOptions(queryClient)),
          };
        },
        { wrapper },
      );
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
      act(() => {
        result.current.queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
        result.current.queryClient.setQueryData(unrelatedKey, { rootPath: "/other", entries: [] });
        result.current.queryClient.setQueryData<string>(otherFileKey, "other access mode");
      });
      let saved: WorkspaceTextFileWriteResult | undefined;
      await act(async () => {
        saved = await result.current.mutation.mutateAsync(input);
      });
      await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));

      expect(
        result.current.queryClient.getQueryData<WorkspaceTextFileWriteResult>(
          filesystemQueryKeys.textFile("/repo", "file.txt", access ? { kind: access } : undefined),
        ),
      ).toEqual(saved);
      expect(result.current.queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
      expect(result.current.queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
      expect(result.current.queryClient.getQueryData<string>(otherFileKey)).toBe(
        "other access mode",
      );
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
    const wrapper = createHostWrapper({
      filesystemWriteTextFile: async () => {
        throw new Error("The file changed after it was loaded.");
      },
    });
    const { result } = renderHook(
      () => {
        const queryClient = useQueryClient();
        return {
          queryClient,
          mutation: useMutation(workspaceTextFileWriteMutationOptions(queryClient)),
        };
      },
      { wrapper },
    );
    act(() => result.current.queryClient.setQueryData(key, baseline));

    let mutationError: unknown;
    await act(async () => {
      try {
        await result.current.mutation.mutateAsync({
          rootPath: "/repo",
          relativePath: "file.txt",
          contents: "draft",
          revision: "revision-1",
        });
      } catch (cause) {
        mutationError = cause;
      }
    });
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(mutationError).toBeInstanceOf(Error);
    if (!(mutationError instanceof Error)) throw mutationError;
    expect(mutationError.message).toBe("The file changed after it was loaded.");
    expect(result.current.queryClient.getQueryData<WorkspaceTextFileReadResult>(key)).toEqual(
      baseline,
    );
  });
});

describe("workspace session file context", () => {
  const chat = { kind: "chat" as const, session: { workspaceId: "workspace", sessionId: "chat" } };
  const textResult = (rootPath: string, relativePath: string): WorkspaceTextFileWriteResult => ({
    kind: "text",
    rootPath,
    relativePath,
    contents: "text",
    size: 4,
    mtimeMs: 1,
    revision: "revision-1",
  });

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
    const wrapper = createHostWrapper({
      filesystemWriteTextFile: async (input) => {
        writes.push(input);
        return { ...textResult(input.rootPath, input.relativePath), contents: input.contents };
      },
    });
    const { result } = renderHook(
      () => {
        const queryClient = useQueryClient();
        return {
          queryClient,
          mutation: useMutation(workspaceTextFileWriteMutationOptions(queryClient)),
        };
      },
      { wrapper },
    );
    const unscopedKey = filesystemQueryKeys.textFile("/worktree", "a.ts");
    act(() => result.current.queryClient.setQueryData<string>(unscopedKey, "unscoped"));

    await act(async () => {
      await result.current.mutation.mutateAsync({
        rootPath: "/worktree",
        relativePath: "a.ts",
        contents: "saved",
        revision: "revision-1",
        scope: chat,
      });
    });

    expect(writes[0]?.scope).toEqual(chat);
    expect(
      result.current.queryClient.getQueryData<WorkspaceTextFileReadResult>(
        workspaceTextFileQueryOptions("/worktree", "a.ts", chat).queryKey,
      ),
    ).toMatchObject({ contents: "saved" });
    expect(result.current.queryClient.getQueryData<string>(unscopedKey)).toBe("unscoped");
  });
});
