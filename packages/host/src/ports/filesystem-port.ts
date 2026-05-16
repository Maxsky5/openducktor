import { Context, type Effect } from "effect";
import type { HostOperationError, HostPathAccessError } from "../effect/host-errors";

export type FilesystemDirectoryEntry = {
  name: string;
  path: string;
};
export type FilesystemStats = {
  isDirectory: boolean;
};
export type FilesystemPort = {
  homeDirectory(): string | null;
  canonicalize(path: string): Effect.Effect<string, HostOperationError>;
  readDirectory(path: string): Effect.Effect<FilesystemDirectoryEntry[], HostOperationError>;
  stat(path: string): Effect.Effect<FilesystemStats, HostOperationError>;
  exists(path: string): Effect.Effect<boolean, HostPathAccessError>;
  join(...paths: string[]): string;
  parent(path: string): string | null;
};

export class FilesystemPortTag extends Context.Tag("@openducktor/host/FilesystemPort")<
  FilesystemPortTag,
  FilesystemPort
>() {}
