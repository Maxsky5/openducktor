import { describe, expect, test } from "bun:test";
import type {
  DirectoryListing,
  WorkspaceFileTree,
  WorkspaceTextFileReadResult,
} from "@openducktor/contracts";
import { createQueryClient } from "@/lib/query-client";
import { workspaceFileTreeQueryOptions } from "./filesystem";

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
          paths: [],
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
      }),
    };
    const queryClient = createQueryClient();

    await queryClient.fetchQuery(workspaceFileTreeQueryOptions("/repo", "origin/main", hostClient));

    expect(inputs).toEqual([{ rootPath: "/repo", targetBranch: "origin/main" }]);
  });
});
