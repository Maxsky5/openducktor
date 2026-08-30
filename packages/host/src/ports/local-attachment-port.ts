import { Context, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
} from "../effect/host-errors";

export type LocalAttachmentEntry = {
  path: string;
  fileName: string;
};
export type LocalAttachmentPort = {
  stageDirectory(): string;
  joinPath(...segments: string[]): string;
  relativePath(from: string, to: string): string;
  isAbsolutePath(path: string): boolean;
  canonicalizePath(path: string): Effect.Effect<string, HostOperationErrorAggregate>;
  ensureDirectory(path: string): Effect.Effect<void, HostOperationErrorAggregate>;
  writeFile(path: string, bytes: Uint8Array): Effect.Effect<void, HostOperationErrorAggregate>;
  readDirectory(path: string): Effect.Effect<LocalAttachmentEntry[], HostOperationErrorAggregate>;
  modifiedTimeMs(path: string): Effect.Effect<number, HostOperationErrorAggregate>;
  exists(path: string): Effect.Effect<boolean, HostPathAccessErrorAggregate>;
};

export class LocalAttachmentPortTag extends Context.Tag("@openducktor/host/LocalAttachmentPort")<
  LocalAttachmentPortTag,
  LocalAttachmentPort
>() {}
