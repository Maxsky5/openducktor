import { Context, Data, type Effect } from "effect";
import type { HostOperationError, HostPathAccessError } from "../effect/host-errors";

export type FilesystemDirectoryEntry = {
  name: string;
  path: string;
};
export type FilesystemStats = {
  isDirectory: boolean;
  isFile?: boolean;
  size?: number;
  mtimeMs?: number;
};
export type FilesystemStatOptions = {
  followSymbolicLinks?: boolean;
};
export type FilesystemFileSnapshot = {
  bytes: Uint8Array;
  isFile: boolean;
  size: number;
  mtimeMs: number | null;
  revision: string;
};
export type FilesystemFileOperationErrorCode =
  | "io_failure"
  | "permission_denied"
  | "stale_revision"
  | "too_large"
  | "unavailable_file";
export class FilesystemFileOperationError extends Data.TaggedError("FilesystemFileOperationError")<{
  readonly code: FilesystemFileOperationErrorCode;
  readonly message: string;
  readonly path: string;
  readonly operation: "read_snapshot" | "replace";
  readonly cause?: unknown;
}> {}
export type FilesystemPort = {
  homeDirectory(): string | null;
  canonicalize(path: string): Effect.Effect<string, HostOperationError>;
  readDirectory(path: string): Effect.Effect<FilesystemDirectoryEntry[], HostOperationError>;
  readFileBytes(path: string, maxBytes: number): Effect.Effect<Uint8Array, HostOperationError>;
  readFileSnapshot(
    path: string,
    maxBytes: number,
  ): Effect.Effect<FilesystemFileSnapshot, FilesystemFileOperationError>;
  replaceFileBytes(input: {
    path: string;
    expectedRevision: string;
    bytes: Uint8Array;
    maxCurrentBytes: number;
  }): Effect.Effect<FilesystemFileSnapshot, FilesystemFileOperationError>;
  stat(
    path: string,
    options?: FilesystemStatOptions,
  ): Effect.Effect<FilesystemStats, HostOperationError>;
  exists(path: string): Effect.Effect<boolean, HostPathAccessError>;
  join(...paths: string[]): string;
  relative(from: string, to: string): string;
  parent(path: string): string | null;
};

export class FilesystemPortTag extends Context.Tag("@openducktor/host/FilesystemPort")<
  FilesystemPortTag,
  FilesystemPort
>() {}
