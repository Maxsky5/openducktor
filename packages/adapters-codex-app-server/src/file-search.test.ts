import { describe, expect, test } from "bun:test";
import { searchCodexFiles } from "./file-search";
import type { CodexAppServerClient } from "./types";

const createClient = (
  response: unknown,
  calls: Array<{ query: string; roots: string[]; cancellationToken: string | null }>,
): CodexAppServerClient =>
  ({
    async fuzzyFileSearch(params) {
      calls.push(params);
      return response as Awaited<ReturnType<CodexAppServerClient["fuzzyFileSearch"]>>;
    },
  }) as CodexAppServerClient;

describe("searchCodexFiles", () => {
  test("calls Codex fuzzyFileSearch and maps ordered file and directory results", async () => {
    const calls: Array<{ query: string; roots: string[]; cancellationToken: string | null }> = [];
    const client = createClient(
      {
        files: [
          {
            root: "/repo/worktree",
            path: "src/main.ts",
            match_type: "file",
            file_name: "main.ts",
            score: 9.75,
            indices: [0, 1, 2],
          },
          {
            root: "/repo/worktree",
            path: "/repo/worktree/src/components/",
            match_type: "directory",
            file_name: "components",
            score: 8,
            indices: null,
          },
          {
            root: "/repo/worktree",
            path: "styles/app.css",
            match_type: "file",
            file_name: "",
            score: 4,
            indices: [],
          },
        ],
      },
      calls,
    );

    await expect(
      searchCodexFiles(client, {
        query: "",
        workingDirectory: "/repo/worktree",
      }),
    ).resolves.toEqual([
      { id: "src/main.ts", path: "src/main.ts", name: "main.ts", kind: "code" },
      {
        id: "src/components",
        path: "src/components",
        name: "components",
        kind: "directory",
      },
      { id: "styles/app.css", path: "styles/app.css", name: "app.css", kind: "css" },
    ]);
    expect(calls).toEqual([{ query: "", roots: ["/repo/worktree"], cancellationToken: null }]);
  });

  test("returns empty results only when Codex returns an empty files array", async () => {
    const calls: Array<{ query: string; roots: string[]; cancellationToken: string | null }> = [];
    const client = createClient({ files: [] }, calls);

    await expect(
      searchCodexFiles(client, {
        query: "src",
        workingDirectory: "/repo/worktree",
      }),
    ).resolves.toEqual([]);
    expect(calls).toEqual([{ query: "src", roots: ["/repo/worktree"], cancellationToken: null }]);
  });

  test("does not map escaped absolute paths to project-relative references", async () => {
    const client = createClient(
      {
        files: [
          {
            root: "/repo/worktree",
            path: "/repo/worktree/../outside.ts",
            match_type: "file",
            file_name: "outside.ts",
            score: 4,
            indices: null,
          },
        ],
      },
      [],
    );

    await expect(
      searchCodexFiles(client, {
        query: "outside",
        workingDirectory: "/repo/worktree",
      }),
    ).resolves.toEqual([
      {
        id: "/repo/outside.ts",
        path: "/repo/outside.ts",
        name: "outside.ts",
        kind: "code",
      },
    ]);
  });

  test("rejects malformed Codex fuzzyFileSearch payloads", async () => {
    const client = createClient(
      {
        files: [
          {
            root: "/repo/worktree",
            path: "src/link",
            match_type: "symlink",
            file_name: "link",
            score: 1,
            indices: null,
          },
        ],
      },
      [],
    );

    await expect(
      searchCodexFiles(client, {
        query: "link",
        workingDirectory: "/repo/worktree",
      }),
    ).rejects.toThrow("Codex fuzzyFileSearch result 0 has unsupported match_type 'symlink'.");
  });

  test("propagates upstream Codex app-server failures", async () => {
    const client = {
      async fuzzyFileSearch() {
        throw new Error("Codex app-server unavailable");
      },
    } as CodexAppServerClient;

    await expect(
      searchCodexFiles(client, {
        query: "src",
        workingDirectory: "/repo/worktree",
      }),
    ).rejects.toThrow("Codex app-server unavailable");
  });
});
