import { describe, expect, test } from "bun:test";
import type { FileDiff, FileStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { FilesystemPort, FilesystemStats } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import { createWorkspaceFilesService } from "./workspace-files-service";

type FakeFilesystemInput = {
  canonical?: Record<string, string>;
  linkStats?: Record<string, FilesystemStats>;
  relative?: (from: string, to: string) => string;
  readLimits?: number[];
  statOptions?: Array<{ followSymbolicLinks: boolean; path: string }>;
  stats?: Record<string, FilesystemStats>;
  files?: Record<string, Uint8Array>;
};

const encoder = new TextEncoder();

const hostOperationError = (message: string): HostOperationError =>
  new HostOperationError({
    operation: "workspace-files-test",
    message,
  });

const createFakeFilesystem = ({
  canonical = {},
  linkStats = {},
  relative,
  readLimits,
  statOptions,
  stats = {},
  files = {},
}: FakeFilesystemInput = {}): FilesystemPort => ({
  homeDirectory: () => "/home/dev",
  canonicalize: (path) => Effect.succeed(canonical[path] ?? path),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: (path, maxBytes) => {
    if (maxBytes !== undefined) {
      readLimits?.push(maxBytes);
    }
    const value = files[path];
    return value
      ? Effect.succeed(maxBytes === undefined ? value : value.slice(0, maxBytes))
      : Effect.fail(hostOperationError(`Missing file ${path}`));
  },
  stat: (path, options) => {
    const followSymbolicLinks = options?.followSymbolicLinks ?? true;
    statOptions?.push({ followSymbolicLinks, path });
    const value = followSymbolicLinks ? stats[path] : (linkStats[path] ?? stats[path]);
    return value ? Effect.succeed(value) : Effect.fail(hostOperationError(`Missing stat ${path}`));
  },
  exists: () => Effect.succeed(true),
  join: (...paths) => paths.join("/").replaceAll(/\/+/g, "/"),
  parent: (path) => {
    const parent = path.split("/").slice(0, -1).join("/");
    return parent.length > 0 ? parent : null;
  },
  relative:
    relative ??
    ((from, to) => {
      if (to === from) {
        return "";
      }
      if (to.startsWith(`${from}/`)) {
        return to.slice(from.length + 1);
      }
      return `../${to}`;
    }),
});

const createFakeGitPort = ({
  isRepository = true,
  repositoryRoot = "/repo",
  files = [],
  statuses = [],
  diffs = [],
  changedFiles,
}: {
  isRepository?: boolean;
  repositoryRoot?: string;
  files?: string[];
  statuses?: FileStatus[];
  diffs?: FileDiff[];
  changedFiles?: Array<{ path: string; status: string }>;
} = {}): GitPort =>
  ({
    isGitRepository: () => Effect.succeed(isRepository),
    getRepositoryRoot: () => Effect.succeed(repositoryRoot),
    listFiles: () => Effect.succeed(files),
    getStatus: () => Effect.succeed(statuses),
    getDiff: () => Effect.succeed(diffs),
    listChangedFiles: () =>
      Effect.succeed(changedFiles ?? diffs.map((diff) => ({ path: diff.file, status: diff.type }))),
  }) as unknown as GitPort;

describe("createWorkspaceFilesService", () => {
  test("lists git-tracked files, parent directories, and compatible git status", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/README.md": { isDirectory: false, isFile: true, size: 12, mtimeMs: 10 },
          "/repo/src/index.ts": { isDirectory: false, isFile: true, size: 42, mtimeMs: 20 },
          "/repo/src/util/helpers.ts": {
            isDirectory: false,
            isFile: true,
            size: 18,
            mtimeMs: 30,
          },
        },
      }),
      createFakeGitPort({
        files: ["src/util/helpers.ts", "README.md", "src/index.ts"],
        statuses: [{ path: "src/index.ts", status: "modified", staged: false }],
      }),
    );

    const tree = await Effect.runPromise(service.listTree({ rootPath: "/repo" }));

    expect(tree.entries).toContainEqual({
      path: "src",
      kind: "directory",
      size: null,
      mtimeMs: null,
      gitStatus: null,
    });
    expect(tree.entries).toContainEqual({
      path: "src/index.ts",
      kind: "file",
      size: 42,
      mtimeMs: 20,
      gitStatus: "modified",
    });
  });

  test("keeps deleted tracked files from failing the whole tree", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/README.md": { isDirectory: false, isFile: true, size: 12, mtimeMs: 10 },
        },
      }),
      createFakeGitPort({
        files: ["README.md", "src/deleted.ts"],
        statuses: [{ path: "src/deleted.ts", status: "deleted", staged: false }],
      }),
    );

    const tree = await Effect.runPromise(service.listTree({ rootPath: "/repo" }));

    expect(tree.entries).toContainEqual({
      path: "src/deleted.ts",
      kind: "file",
      size: null,
      mtimeMs: null,
      gitStatus: "deleted",
    });
    expect(tree.entries).toContainEqual({
      path: "README.md",
      kind: "file",
      size: 12,
      mtimeMs: 10,
      gitStatus: null,
    });
  });

  test("marks target-branch diff files even when the worktree is clean", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/apps/api/src/lib/auth.ts": {
            isDirectory: false,
            isFile: true,
            size: 12,
            mtimeMs: 10,
          },
          "/repo/apps/web/src/components/LandingPage.tsx": {
            isDirectory: false,
            isFile: true,
            size: 42,
            mtimeMs: 20,
          },
        },
      }),
      createFakeGitPort({
        files: ["apps/api/src/lib/auth.ts", "apps/web/src/components/LandingPage.tsx"],
        statuses: [],
        diffs: [
          {
            file: "apps/api/src/lib/auth.ts",
            type: "modified",
            additions: 2,
            deletions: 1,
            diff: "",
          },
          {
            file: "apps/web/src/components/LandingPage.tsx",
            type: "modified",
            additions: 4,
            deletions: 1,
            diff: "",
          },
        ],
      }),
    );

    const tree = await Effect.runPromise(
      service.listTree({ rootPath: "/repo", targetBranch: "origin/main" }),
    );

    expect(tree.entries).toContainEqual({
      path: "apps/api/src/lib/auth.ts",
      kind: "file",
      size: 12,
      mtimeMs: 10,
      gitStatus: "modified",
    });
    expect(tree.entries).toContainEqual({
      path: "apps/web/src/components/LandingPage.tsx",
      kind: "file",
      size: 42,
      mtimeMs: 20,
      gitStatus: "modified",
    });
  });

  test("skips non-materialized target changes while preserving deletions", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/src/visible.ts": { isDirectory: false, isFile: true, size: 12, mtimeMs: 10 },
        },
      }),
      createFakeGitPort({
        files: ["src/visible.ts"],
        changedFiles: [
          { path: "src/skipped.ts", status: "modified" },
          { path: "src/deleted.ts", status: "deleted" },
        ],
      }),
    );

    const tree = await Effect.runPromise(
      service.listTree({ rootPath: "/repo", targetBranch: "origin/main" }),
    );

    expect(tree.entries.map((entry) => entry.path)).not.toContain("src/skipped.ts");
    expect(tree.entries).toContainEqual({
      path: "src/deleted.ts",
      kind: "file",
      size: null,
      mtimeMs: null,
      gitStatus: "deleted",
    });
  });

  test("normalizes repository-relative changes to a nested workspace root", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo/packages/host": { isDirectory: true },
          "/repo/packages/host/src/status.ts": {
            isDirectory: false,
            isFile: true,
            size: 12,
            mtimeMs: 10,
          },
          "/repo/packages/host/src/target.ts": {
            isDirectory: false,
            isFile: true,
            size: 18,
            mtimeMs: 20,
          },
        },
      }),
      createFakeGitPort({
        repositoryRoot: "/repo",
        files: ["src/status.ts", "src/target.ts"],
        statuses: [
          { path: "packages/host/src/status.ts", status: "modified", staged: false },
          { path: "packages/frontend/src/outside.ts", status: "modified", staged: false },
        ],
        changedFiles: [
          { path: "packages/host/src/target.ts", status: "modified" },
          { path: "packages/frontend/src/outside.ts", status: "modified" },
        ],
      }),
    );

    const tree = await Effect.runPromise(
      service.listTree({ rootPath: "/repo/packages/host", targetBranch: "origin/main" }),
    );

    expect(tree.entries).toContainEqual({
      path: "src/status.ts",
      kind: "file",
      size: 12,
      mtimeMs: 10,
      gitStatus: "modified",
    });
    expect(tree.entries).toContainEqual({
      path: "src/target.ts",
      kind: "file",
      size: 18,
      mtimeMs: 20,
      gitStatus: "modified",
    });
    expect(tree.entries.map((entry) => entry.path)).not.toContain(
      "packages/frontend/src/outside.ts",
    );
  });

  test("reads a contained text file", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/src/index.ts": { isDirectory: false, isFile: true, size: 18, mtimeMs: 20 },
        },
        files: {
          "/repo/src/index.ts": encoder.encode("console.log('ok');"),
        },
      }),
      createFakeGitPort({ files: ["src/index.ts"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "src/index.ts" })),
    ).resolves.toMatchObject({
      kind: "text",
      rootPath: "/repo",
      relativePath: "src/index.ts",
      contents: "console.log('ok');",
      size: 18,
      mtimeMs: 20,
    });
  });

  test("preserves significant whitespace in relative file paths", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/ padded.ts ": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
        files: {
          "/repo/ padded.ts ": encoder.encode("ok"),
        },
      }),
      createFakeGitPort({ files: [" padded.ts "] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: " padded.ts " })),
    ).resolves.toMatchObject({
      kind: "text",
      relativePath: " padded.ts ",
      contents: "ok",
    });
  });

  test("reports binary files as unsupported", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/image.bin": { isDirectory: false, isFile: true, size: 3, mtimeMs: 20 },
        },
        files: {
          "/repo/image.bin": new Uint8Array([0x66, 0, 0x6f]),
        },
      }),
      createFakeGitPort({ files: ["image.bin"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "image.bin" })),
    ).resolves.toMatchObject({
      kind: "unsupported",
      rootPath: "/repo",
      relativePath: "image.bin",
      reason: "binary",
      message: "Binary files cannot be previewed as text.",
      size: 3,
      mtimeMs: 20,
    });
  });

  test("bounds the actual file read when the file grows after stat", async () => {
    const readLimits: number[] = [];
    const grownContents = new Uint8Array(1024 * 1024 + 1).fill(0x61);
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        readLimits,
        stats: {
          "/repo": { isDirectory: true },
          "/repo/growing.txt": { isDirectory: false, isFile: true, size: 18, mtimeMs: 20 },
        },
        files: {
          "/repo/growing.txt": grownContents,
        },
      }),
      createFakeGitPort({ files: ["growing.txt"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "growing.txt" })),
    ).resolves.toMatchObject({
      kind: "unsupported",
      reason: "too_large",
      size: 1024 * 1024 + 1,
    });
    expect(readLimits).toEqual([1024 * 1024 + 1]);
  });

  test("rejects file paths outside the selected root", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        canonical: {
          "/repo/../secret.txt": "/secret.txt",
        },
        stats: {
          "/repo": { isDirectory: true },
        },
      }),
      createFakeGitPort({ files: ["../secret.txt"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "../secret.txt" })),
    ).rejects.toThrow("outside the selected workspace root");
  });

  test("rejects files that are not exposed by the workspace file tree", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/.env": { isDirectory: false, isFile: true, size: 12, mtimeMs: 20 },
        },
        files: {
          "/repo/.env": encoder.encode("SECRET=value"),
        },
      }),
      createFakeGitPort({ files: ["README.md"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: ".env" })),
    ).rejects.toThrow("not available in the workspace file tree");
  });

  test("requires a Git repository when reading a workspace file", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/README.md": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
      }),
      createFakeGitPort({ isRepository: false, files: ["README.md"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "README.md" })),
    ).rejects.toThrow("File explorer requires a Git repository root");
  });

  test("accepts contained files whose names begin with two dots", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/..config": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
        files: { "/repo/..config": encoder.encode("ok") },
      }),
      createFakeGitPort({ files: ["..config"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "..config" })),
    ).resolves.toMatchObject({ kind: "text", relativePath: "..config", contents: "ok" });
  });

  test("rejects canonical files that resolve to an absolute UNC path", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        canonical: {
          "/repo/link.txt": "\\\\server\\share\\secret.txt",
        },
        relative: () => "\\\\server\\share\\secret.txt",
        stats: {
          "/repo": { isDirectory: true },
        },
      }),
      createFakeGitPort({ files: ["link.txt"] }),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "link.txt" })),
    ).rejects.toThrow("outside the selected workspace root");
  });

  test("uses changed-file metadata without loading full diffs", async () => {
    let getDiffCalls = 0;
    let listChangedFilesCalls = 0;
    const gitPort = createFakeGitPort({
      files: ["src/index.ts"],
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
    });
    gitPort.getDiff = () => {
      getDiffCalls += 1;
      return Effect.succeed([]);
    };
    gitPort.listChangedFiles = () => {
      listChangedFilesCalls += 1;
      return Effect.succeed([{ path: "src/index.ts", status: "modified" }]);
    };
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/src/index.ts": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
      }),
      gitPort,
    );

    const tree = await Effect.runPromise(
      service.listTree({ rootPath: "/repo", targetBranch: "origin/main" }),
    );

    expect(tree.entries).toContainEqual({
      path: "src/index.ts",
      kind: "file",
      size: 2,
      mtimeMs: 20,
      gitStatus: "modified",
    });
    expect(listChangedFilesCalls).toBe(1);
    expect(getDiffCalls).toBe(0);
  });

  test("uses the renamed destination path from git status", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/src/new.ts": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
      }),
      createFakeGitPort({
        files: ["src/new.ts"],
        statuses: [{ path: "src/new.ts", status: "renamed", staged: true }],
      }),
    );

    const tree = await Effect.runPromise(service.listTree({ rootPath: "/repo" }));

    expect(tree.entries).toContainEqual({
      path: "src/new.ts",
      kind: "file",
      size: 2,
      mtimeMs: 20,
      gitStatus: "renamed",
    });
  });

  test("adapts known Git-only statuses without a generic fallback", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/copied.ts": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
          "/repo/conflicted.ts": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
          "/repo/typechanged.ts": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
      }),
      createFakeGitPort({
        files: ["copied.ts", "conflicted.ts", "typechanged.ts"],
        statuses: [
          { path: "copied.ts", status: "copied", staged: true },
          { path: "conflicted.ts", status: "unmerged", staged: true },
          { path: "typechanged.ts", status: "typechange", staged: false },
        ],
      }),
    );

    const tree = await Effect.runPromise(service.listTree({ rootPath: "/repo" }));

    expect(tree.entries.find((entry) => entry.path === "copied.ts")?.gitStatus).toBe("added");
    expect(tree.entries.find((entry) => entry.path === "conflicted.ts")?.gitStatus).toBe(
      "modified",
    );
    expect(tree.entries.find((entry) => entry.path === "typechanged.ts")?.gitStatus).toBe(
      "modified",
    );
  });

  test("rejects unrecognized Git status values", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/src/index.ts": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
      }),
      createFakeGitPort({
        files: ["src/index.ts"],
        statuses: [{ path: "src/index.ts", status: "unexpected", staged: false }],
      }),
    );

    await expect(Effect.runPromise(service.listTree({ rootPath: "/repo" }))).rejects.toThrow(
      "Unrecognized Git status value: unexpected",
    );
  });

  test("uses non-following metadata for tracked symlinks", async () => {
    const statOptions: Array<{ followSymbolicLinks: boolean; path: string }> = [];
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        statOptions,
        stats: {
          "/repo": { isDirectory: true },
        },
        linkStats: {
          "/repo/broken-link": { isDirectory: false, isFile: false, size: 14, mtimeMs: 20 },
        },
      }),
      createFakeGitPort({ files: ["broken-link"] }),
    );

    const tree = await Effect.runPromise(service.listTree({ rootPath: "/repo" }));

    expect(tree.entries).toContainEqual({
      path: "broken-link",
      kind: "file",
      size: 14,
      mtimeMs: 20,
      gitStatus: null,
    });
    expect(statOptions).toContainEqual({
      path: "/repo/broken-link",
      followSymbolicLinks: false,
    });
  });

  test("preserves the more specific status when target and worktree changes overlap", async () => {
    const service = createWorkspaceFilesService(
      createFakeFilesystem({
        stats: {
          "/repo": { isDirectory: true },
          "/repo/src/new.ts": { isDirectory: false, isFile: true, size: 2, mtimeMs: 20 },
        },
      }),
      createFakeGitPort({
        files: ["src/new.ts"],
        changedFiles: [{ path: "src/new.ts", status: "renamed" }],
        statuses: [{ path: "src/new.ts", status: "modified", staged: false }],
      }),
    );

    const tree = await Effect.runPromise(
      service.listTree({ rootPath: "/repo", targetBranch: "origin/main" }),
    );

    expect(tree.entries.find((entry) => entry.path === "src/new.ts")?.gitStatus).toBe("renamed");
  });
});
