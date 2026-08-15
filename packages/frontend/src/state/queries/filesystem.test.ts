import { describe, expect, test } from "bun:test";
import type {
  DirectoryListing,
  WorkspaceFileTree,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import {
  filesystemQueryKeys,
  workspaceFileTreeQueryOptions,
  workspaceTextFileWriteMutationOptions,
} from "./filesystem";

const unusedDirectoryListing = async (): Promise<DirectoryListing> => {
  throw new Error("not used");
};

const unusedTree = async (): Promise<WorkspaceFileTree> => {
  throw new Error("not used");
};

const unusedTextFile = async (): Promise<WorkspaceTextFileReadResult> => {
  throw new Error("not used");
};

describe("workspaceFileTreeQueryOptions", () => {
  test("passes the target branch to the filesystem tree host read", async () => {
    const inputs: unknown[] = [];
    const hostClient = {
      filesystemListDirectory: async (): Promise<DirectoryListing> => ({
        currentPath: "/repo",
        currentPathIsGitRepo: true,
        parentPath: null,
        homePath: "/home/dev",
        entries: [],
      }),
      filesystemListTree: async (input: unknown): Promise<WorkspaceFileTree> => {
        inputs.push(input);
        return {
          rootPath: "/repo",
          entries: [],
        };
      },
      filesystemReadTextFile: async (): Promise<WorkspaceTextFileReadResult> => ({
        kind: "text",
        rootPath: "/repo",
        relativePath: "README.md",
        contents: "",
        size: 0,
        mtimeMs: null,
        revision: "revision-1",
      }),
      filesystemWriteTextFile: async () => {
        throw new Error("not used");
      },
    };
    const { result } = renderHook(() => useQueryClient(), { wrapper: IsolatedQueryWrapper });

    await result.current.fetchQuery(
      workspaceFileTreeQueryOptions("/repo", "origin/main", hostClient),
    );

    expect(inputs).toEqual([{ rootPath: "/repo", targetBranch: "origin/main" }]);
  });

  test("updates the exact text cache and invalidates only the workspace tree after save", async () => {
    const hostClient = {
      filesystemListDirectory: unusedDirectoryListing,
      filesystemListTree: unusedTree,
      filesystemReadTextFile: unusedTextFile,
      filesystemWriteTextFile: async (
        input: WorkspaceTextFileWriteInput,
      ): Promise<WorkspaceTextFileWriteResult> => ({
        kind: "text",
        ...input,
        size: input.contents.length,
        mtimeMs: 2,
        revision: "revision-2",
      }),
    };
    const { result } = renderHook(
      () => {
        const queryClient = useQueryClient();
        return {
          queryClient,
          mutation: useMutation(workspaceTextFileWriteMutationOptions(queryClient, hostClient)),
        };
      },
      { wrapper: IsolatedQueryWrapper },
    );
    const input = {
      rootPath: "/repo",
      relativePath: "file.txt",
      contents: "saved",
      revision: "revision-1",
    };
    const treeKey = filesystemQueryKeys.treeRoot("/repo");
    const unrelatedKey = filesystemQueryKeys.treeRoot("/other");
    act(() => {
      result.current.queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
      result.current.queryClient.setQueryData(unrelatedKey, { rootPath: "/other", entries: [] });
    });
    let saved: WorkspaceTextFileWriteResult | undefined;
    await act(async () => {
      saved = await result.current.mutation.mutateAsync(input);
    });
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));

    expect(
      result.current.queryClient.getQueryData<WorkspaceTextFileWriteResult>(
        filesystemQueryKeys.textFile("/repo", "file.txt"),
      ),
    ).toEqual(saved);
    expect(result.current.queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
    expect(result.current.queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

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
    const hostClient = {
      filesystemListDirectory: unusedDirectoryListing,
      filesystemListTree: unusedTree,
      filesystemReadTextFile: unusedTextFile,
      filesystemWriteTextFile: async () => {
        throw new Error("The file changed after it was loaded.");
      },
    };
    const { result } = renderHook(
      () => {
        const queryClient = useQueryClient();
        return {
          queryClient,
          mutation: useMutation(workspaceTextFileWriteMutationOptions(queryClient, hostClient)),
        };
      },
      { wrapper: IsolatedQueryWrapper },
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
    expect((mutationError as Error).message).toBe("The file changed after it was loaded.");
    expect(result.current.queryClient.getQueryData<WorkspaceTextFileReadResult>(key)).toEqual(
      baseline,
    );
  });
});
