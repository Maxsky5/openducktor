import { describe, expect, test } from "bun:test";
import type {
  DirectoryListing,
  WorkspaceFileTree,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import type { MutationFunction, MutationOptions } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";
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
    const queryClient = createQueryClient();

    await queryClient.fetchQuery(workspaceFileTreeQueryOptions("/repo", "origin/main", hostClient));

    expect(inputs).toEqual([{ rootPath: "/repo", targetBranch: "origin/main" }]);
  });

  test("updates the exact text cache and invalidates only the workspace tree after save", async () => {
    const queryClient = createQueryClient();
    const invalidations: unknown[] = [];
    const originalInvalidate = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = async (filters) => {
      invalidations.push(filters?.queryKey);
      return originalInvalidate(filters);
    };
    const options = workspaceTextFileWriteMutationOptions(queryClient, {
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
    });
    const input = {
      rootPath: "/repo",
      relativePath: "file.txt",
      contents: "saved",
      revision: "revision-1",
    };
    const mutationFn = options.mutationFn as MutationFunction<
      WorkspaceTextFileWriteResult,
      WorkspaceTextFileWriteInput
    >;
    const result = await mutationFn(input, {} as never);

    const onSuccess = options.onSuccess as NonNullable<
      MutationOptions<WorkspaceTextFileWriteResult, Error, WorkspaceTextFileWriteInput>["onSuccess"]
    >;
    await onSuccess(result, input, undefined, undefined as never);

    expect(
      queryClient.getQueryData<WorkspaceTextFileWriteResult>(
        filesystemQueryKeys.textFile("/repo", "file.txt"),
      ),
    ).toEqual(result);
    expect(invalidations).toEqual([filesystemQueryKeys.treeRoot("/repo")]);
  });

  test("leaves the server cache unchanged when the write fails", async () => {
    const queryClient = createQueryClient();
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
    queryClient.setQueryData(key, baseline);
    const options = workspaceTextFileWriteMutationOptions(queryClient, {
      filesystemListDirectory: unusedDirectoryListing,
      filesystemListTree: unusedTree,
      filesystemReadTextFile: unusedTextFile,
      filesystemWriteTextFile: async () => {
        throw new Error("The file changed after it was loaded.");
      },
    });
    const mutationFn = options.mutationFn as MutationFunction<
      WorkspaceTextFileWriteResult,
      WorkspaceTextFileWriteInput
    >;

    await expect(
      mutationFn(
        {
          rootPath: "/repo",
          relativePath: "file.txt",
          contents: "draft",
          revision: "revision-1",
        },
        {} as never,
      ),
    ).rejects.toThrow("The file changed after it was loaded.");
    expect(queryClient.getQueryData<WorkspaceTextFileReadResult>(key)).toEqual(baseline);
  });
});
