import { Context, type Effect } from "effect";
import type { HostOperationError, HostPathAccessError } from "../effect/host-errors";

export type LocalAttachmentEntry = {
  path: string;
  fileName: string;
};
export type LocalAttachmentPort = {
  stageDirectory(): string;
  joinPath(...segments: string[]): string;
  relativePath(from: string, to: string): string;
  isAbsolutePath(path: string): boolean;
  canonicalizePath(path: string): Effect.Effect<string, HostOperationError>;
  ensureDirectory(path: string): Effect.Effect<void, HostOperationError>;
  writeFile(path: string, bytes: Uint8Array): Effect.Effect<void, HostOperationError>;
  readDirectory(path: string): Effect.Effect<LocalAttachmentEntry[], HostOperationError>;
  modifiedTimeMs(path: string): Effect.Effect<number, HostOperationError>;
  exists(path: string): Effect.Effect<boolean, HostPathAccessError>;
};

export class LocalAttachmentPortTag extends Context.Tag("@openducktor/host/LocalAttachmentPort")<
  LocalAttachmentPortTag,
  LocalAttachmentPort
>() {}
