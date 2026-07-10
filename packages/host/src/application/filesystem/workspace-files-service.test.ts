import { describe, expect, test } from "bun:test";
import type { FileDiff, FileStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { FilesystemPort, FilesystemStats } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import { createWorkspaceFilesService } from "./workspace-files-service";

type FakeFilesystemInput = {
  canonical?: Record<string, string>;
  relative?: (from: string, to: string) => string;
  readLimits?: number[];
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
  relative,
  readLimits,
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
  stat: (path) => {
    const value = stats[path];
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
  files = [],
  statuses = [],
  diffs = [],
  changedFiles,
}: {
  isRepository?: boolean;
  files?: string[];
  statuses?: FileStatus[];
  diffs?: FileDiff[];
  changedFiles?: Array<{ path: string; status: string }>;
} = {}): GitPort =>
  ({
    isGitRepository: () => Effect.succeed(isRepository),
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
      createFakeGitPort(),
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
      createFakeGitPort(),
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
      createFakeGitPort(),
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
      createFakeGitPort(),
    );

    await expect(
      Effect.runPromise(service.readTextFile({ rootPath: "/repo", relativePath: "../secret.txt" })),
    ).rejects.toThrow("outside the selected workspace root");
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
      createFakeGitPort(),
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
      createFakeGitPort(),
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
