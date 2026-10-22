import { Context, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostPathNotFoundErrorAggregate,
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
  fileInfo(
    path: string,
  ): Effect.Effect<LocalFileInfo, HostPathAccessErrorAggregate | HostPathNotFoundErrorAggregate>;
  readFile(path: string): Effect.Effect<Uint8Array, HostOperationErrorAggregate>;
};

export type LocalFileInfo = { isFile: boolean; byteSize: number };

export class LocalAttachmentPortTag extends Context.Service<
  LocalAttachmentPortTag,
  LocalAttachmentPort
>()("@openducktor/host/LocalAttachmentPort") {}
