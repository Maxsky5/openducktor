import type { SessionHtmlPreviewReadResult } from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../effect/host-errors";

type SessionHtmlPreviewStoreScope = {
  workspaceId: string;
};

type SaveSessionHtmlPreviewInput = SessionHtmlPreviewStoreScope & {
  previewId: string;
  html: string;
  byteSize: number;
};

type ReadSessionHtmlPreviewInput = SessionHtmlPreviewStoreScope & {
  previewId: string;
};

export type SessionHtmlPreviewStoreWriteError = HostOperationError | HostValidationError;
export type SessionHtmlPreviewStoreReadError =
  | HostOperationError
  | HostResourceError
  | HostValidationError;

/** Persists published session HTML previews in a dedicated workspace-scoped folder on disk. */
export type SessionHtmlPreviewStorePort = {
  save(
    input: SaveSessionHtmlPreviewInput,
  ): Effect.Effect<SessionHtmlPreviewReadResult, SessionHtmlPreviewStoreWriteError>;
  read(
    input: ReadSessionHtmlPreviewInput,
  ): Effect.Effect<SessionHtmlPreviewReadResult, SessionHtmlPreviewStoreReadError>;
  removeWorkspace(workspaceId: string): Effect.Effect<void, SessionHtmlPreviewStoreWriteError>;
};
