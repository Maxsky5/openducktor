import { createHash } from "node:crypto";
import type { FileDiff } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { FilesystemPort, FilesystemStats } from "../../../ports/filesystem-port";
import type { GitChangedFile, GitFileStatus, GitPort } from "../../../ports/git-port";
import { createWorkspaceFilesService } from "../workspace-files-service";

type FakeFilesystemInput = {
  canonical?: Record<string, string>;
  linkStats?: Record<string, FilesystemStats>;
  relative?: (from: string, to: string) => string;
  readLimits?: number[];
  statOptions?: Array<{ followSymbolicLinks: boolean; path: string }>;
  stats?: Record<string, FilesystemStats>;
  files?: Record<string, Uint8Array>;
};

const revisionForBytes = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const hostOperationError = (message: string): HostOperationError =>
  new HostOperationError({
    operation: "workspace-files-test",
    message,
  });

export const createFakeFilesystem = ({
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
  readFileSnapshot: (path, maxBytes) => {
    readLimits?.push(maxBytes);
    const value = files[path];
    const metadata = stats[path];
    if (!value || !metadata) {
      return Effect.die(`Missing file ${path}`);
    }
    const bytes = value.slice(0, maxBytes);
    return Effect.succeed({
      bytes,
      isFile: metadata.isFile ?? !metadata.isDirectory,
      size: Math.max(metadata.size ?? 0, bytes.byteLength),
      mtimeMs: metadata.mtimeMs ?? null,
      revision: revisionForBytes(bytes),
    });
  },
  replaceFileBytes: ({ path, expectedRevision, bytes }) => {
    const current = files[path];
    const metadata = stats[path];
    if (!current || !metadata || revisionForBytes(current) !== expectedRevision) {
      return Effect.die(`Cannot replace file ${path}`);
    }
    files[path] = bytes;
    return Effect.succeed({
      bytes,
      isFile: true,
      size: bytes.byteLength,
      mtimeMs: metadata.mtimeMs ?? null,
      revision: revisionForBytes(bytes),
    });
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

export const createFakeGitPort = ({
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
  statuses?: GitFileStatus[];
  diffs?: FileDiff[];
  changedFiles?: GitChangedFile[];
} = {}): Parameters<typeof createWorkspaceFilesService>[1] & Pick<GitPort, "getDiff"> =>
  ({
    isGitRepository: () => Effect.succeed(isRepository),
    getRepositoryRoot: () => Effect.succeed(repositoryRoot),
    listFiles: () => Effect.succeed(files),
    getStatus: () => Effect.succeed(statuses),
    getDiff: () => Effect.succeed(diffs),
    listChangedFiles: () =>
      Effect.succeed(changedFiles ?? diffs.map((diff) => ({ path: diff.file, status: diff.type }))),
  }) satisfies Parameters<typeof createWorkspaceFilesService>[1] & Pick<GitPort, "getDiff">;
