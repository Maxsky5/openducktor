import { describe, expect, test } from "bun:test";
import type { FileStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { FilesystemPort, FilesystemStats } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import { createWorkspaceFilesService } from "./workspace-files-service";

type FakeFilesystemInput = {
  canonical?: Record<string, string>;
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
  stats = {},
  files = {},
}: FakeFilesystemInput = {}): FilesystemPort => ({
  homeDirectory: () => "/home/dev",
  canonicalize: (path) => Effect.succeed(canonical[path] ?? path),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: (path) => {
    const value = files[path];
    return value ? Effect.succeed(value) : Effect.fail(hostOperationError(`Missing file ${path}`));
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
  relative: (from, to) => {
    if (to === from) {
      return "";
    }
    if (to.startsWith(`${from}/`)) {
      return to.slice(from.length + 1);
    }
    return `../${to}`;
  },
});

const createFakeGitPort = ({
  isRepository = true,
  files = [],
  statuses = [],
}: {
  isRepository?: boolean;
  files?: string[];
  statuses?: FileStatus[];
} = {}): GitPort =>
  ({
    isGitRepository: () => Effect.succeed(isRepository),
    listFiles: () => Effect.succeed(files),
    getStatus: () => Effect.succeed(statuses),
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

    expect(tree.paths).toEqual([
      "README.md",
      "src/",
      "src/index.ts",
      "src/util/",
      "src/util/helpers.ts",
    ]);
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
});
