import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { FilesystemDirectoryEntry, FilesystemPort } from "../../ports/filesystem-port";
import {
  createFilesystemService as createEffectFilesystemService,
  FilesystemListDirectoryError,
  type FilesystemService,
} from "./filesystem-service";

const createFilesystemService = (...args: Parameters<typeof createEffectFilesystemService>) =>
  createEffectFilesystemService(...args);
type FakeEntry = {
  name: string;
  path: string;
};
const createFakeFilesystem = ({
  home = "/home/dev",
  canonical = {},
  entries = {},
  stats = {},
  statErrors = {},
  existingPaths = new Set<string>(),
}: {
  home?: string | null;
  canonical?: Record<string, string>;
  entries?: Record<string, FakeEntry[]>;
  stats?: Record<string, boolean>;
  statErrors?: Record<string, Error>;
  existingPaths?: Set<string>;
}): FilesystemPort => ({
  homeDirectory: () => home,
  canonicalize: (path) =>
    Effect.tryPromise({
      try: async () => {
        if (path.includes("missing")) {
          const error = new Error("not found") as Error & {
            code: string;
          };
          error.code = "ENOENT";
          throw error;
        }
        return canonical[path] ?? path;
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    }),
  readDirectory: (path) =>
    Effect.tryPromise({
      try: async () => {
        return (entries[path] ?? []).map(
          (entry): FilesystemDirectoryEntry => ({
            name: entry.name,
            path: entry.path,
          }),
        );
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    }),
  stat: (path) =>
    Effect.tryPromise({
      try: async () => {
        if (statErrors[path]) {
          throw statErrors[path];
        }
        if (stats[path] === undefined) {
          throw new Error(`Missing stat fixture for ${path}`);
        }
        return { isDirectory: stats[path] };
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "test.effect",
          message: cause instanceof Error ? cause.message : String(cause),
          cause: cause,
        }),
    }),
  exists: (path) => Effect.succeed(existingPaths.has(path)),
  readFileBytes: () => Effect.succeed(new Uint8Array()),
  readFileSnapshot: () => Effect.die("not used"),
  replaceFileBytes: () => Effect.die("not used"),
  join: (...paths) => paths.join("/").replaceAll(/\/+/g, "/"),
  parent: (path) => {
    const parent = path.split("/").slice(0, -1).join("/");
    return parent.length > 0 ? parent : null;
  },
  relative: (from, to) => {
    if (to.startsWith(`${from}/`)) {
      return to.slice(from.length + 1);
    }
    return to;
  },
});
const createService = (filesystem: FilesystemPort): FilesystemService =>
  createFilesystemService(filesystem);
describe("createFilesystemService", () => {
  test("lists directories, marks git repos, and sorts entries", async () => {
    const filesystem = createFakeFilesystem({
      canonical: { "/workspace": "/workspace", "/home/dev": "/home/dev" },
      stats: {
        "/workspace": true,
        "/workspace/zeta": true,
        "/workspace/Alpha": true,
        "/workspace/notes.txt": false,
        "/workspace/repo-a": true,
      },
      entries: {
        "/workspace": [
          { name: "zeta", path: "/workspace/zeta" },
          { name: "notes.txt", path: "/workspace/notes.txt" },
          { name: "repo-a", path: "/workspace/repo-a" },
          { name: "Alpha", path: "/workspace/Alpha" },
        ],
      },
      existingPaths: new Set(["/workspace/repo-a/.git"]),
    });
    const listing = await Effect.runPromise(
      createService(filesystem).listDirectory({ path: "/workspace" }),
    );
    expect(listing.currentPath).toBe("/workspace");
    expect(listing.currentPathIsGitRepo).toBe(false);
    expect(listing.entries.map((entry) => [entry.name, entry.isGitRepo])).toEqual([
      ["Alpha", false],
      ["repo-a", true],
      ["zeta", false],
    ]);
  });
  test("includes files only when the caller requests them", async () => {
    const filesystem = createFakeFilesystem({
      canonical: { "/workspace": "/workspace", "/home/dev": "/home/dev" },
      stats: {
        "/workspace": true,
        "/workspace/bin": true,
        "/workspace/codex": false,
      },
      entries: {
        "/workspace": [
          { name: "codex", path: "/workspace/codex" },
          { name: "bin", path: "/workspace/bin" },
        ],
      },
    });

    const listing = await Effect.runPromise(
      createService(filesystem).listDirectory({ path: "/workspace", includeFiles: true }),
    );

    expect(listing.entries).toEqual([
      { name: "bin", path: "/workspace/bin", isDirectory: true, isGitRepo: false },
      { name: "codex", path: "/workspace/codex", isDirectory: false, isGitRepo: false },
    ]);
  });
  test("omits directory entries whose targets disappeared before stat", async () => {
    const missingTargetError = new Error("no such file or directory") as Error & {
      code: string;
    };
    missingTargetError.code = "ENOENT";
    const filesystem = createFakeFilesystem({
      canonical: { "/workspace": "/workspace", "/home/dev": "/home/dev" },
      stats: {
        "/workspace": true,
        "/workspace/claude": false,
      },
      statErrors: { "/workspace/hermes": missingTargetError },
      entries: {
        "/workspace": [
          { name: "claude", path: "/workspace/claude" },
          { name: "hermes", path: "/workspace/hermes" },
        ],
      },
    });

    const listing = await Effect.runPromise(
      createService(filesystem).listDirectory({ path: "/workspace", includeFiles: true }),
    );

    expect(listing.entries).toEqual([
      { name: "claude", path: "/workspace/claude", isDirectory: false, isGitRepo: false },
    ]);
  });
  test("keeps non-missing entry stat failures actionable", async () => {
    const accessError = new Error("permission denied") as Error & { code: string };
    accessError.code = "EACCES";
    const filesystem = createFakeFilesystem({
      canonical: { "/workspace": "/workspace", "/home/dev": "/home/dev" },
      stats: { "/workspace": true },
      statErrors: { "/workspace/private": accessError },
      entries: {
        "/workspace": [{ name: "private", path: "/workspace/private" }],
      },
    });

    const error = await Effect.runPromise(
      Effect.flip(
        createService(filesystem).listDirectory({ path: "/workspace", includeFiles: true }),
      ),
    );

    expect(error).toMatchObject({
      kind: "read_failed",
      message: "Failed to read directory '/workspace': HostOperationError: permission denied",
    });
  });
  test("uses the home directory when path is omitted", async () => {
    const filesystem = createFakeFilesystem({
      canonical: { "/home/dev": "/home/dev" },
      stats: { "/home/dev": true },
      entries: { "/home/dev": [] },
    });
    const listing = await Effect.runPromise(createService(filesystem).listDirectory());
    expect(listing.currentPath).toBe("/home/dev");
    expect(listing.homePath).toBe("/home/dev");
  });
  test("expands tilde paths before canonicalizing", async () => {
    const filesystem = createFakeFilesystem({
      canonical: { "/home/dev/projects": "/home/dev/projects", "/home/dev": "/home/dev" },
      stats: { "/home/dev/projects": true },
      entries: { "/home/dev/projects": [] },
    });
    const listing = await Effect.runPromise(
      createService(filesystem).listDirectory({ path: '  "~/projects" ' }),
    );
    expect(listing.currentPath).toBe("/home/dev/projects");
  });
  test("rejects empty path input", async () => {
    const error = await Effect.runPromise(
      Effect.flip(createService(createFakeFilesystem({})).listDirectory({ path: "   " })),
    );
    expect(error).toMatchObject({
      kind: "invalid_path",
      message: "Path is empty; provide a valid path",
    });
  });
  test("returns a typed not-found error for missing directories", async () => {
    const error = await Effect.runPromise(
      Effect.flip(createService(createFakeFilesystem({})).listDirectory({ path: "/missing" })),
    );
    expect(error).toBeInstanceOf(FilesystemListDirectoryError);
  });
});
