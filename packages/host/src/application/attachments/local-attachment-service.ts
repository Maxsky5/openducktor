import { Deferred, Effect, FiberId } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { LocalAttachmentPort } from "../../ports/local-attachment-port";
import {
  addIndexedStagedAttachment,
  isStagedAttachmentIndexFresh,
  loadStagedAttachmentIndex,
  readStagedAttachmentOriginalName,
  resolveIndexedStagedAttachment,
  type StagedAttachmentIndex,
} from "./local-attachment-index";

export type LocalAttachmentServiceError = HostOperationError | HostValidationError;

export type StagedLocalAttachment = {
  path: string;
};
export type ResolvedLocalAttachment = {
  path: string;
};
export type LocalAttachmentService = {
  stage(
    input: LocalAttachmentStageInput,
  ): Effect.Effect<StagedLocalAttachment, LocalAttachmentServiceError>;
  resolve(
    input: LocalAttachmentResolveInput,
  ): Effect.Effect<ResolvedLocalAttachment, LocalAttachmentServiceError>;
};
const maxAttachmentLookupDisplayLength = 128;
export type LocalAttachmentStageInput = {
  base64Data: string;
  name: string;
};
export type LocalAttachmentResolveInput = {
  path: string;
};
type PendingStagedAttachment = {
  fileName: string;
  modifiedTimeMs: number;
  path: string;
};
type StagedAttachmentIndexFlight = {
  attachmentDirectory: string;
  deferred: Deferred.Deferred<StagedAttachmentIndex, HostOperationError>;
  pendingAttachments: PendingStagedAttachment[];
};
const makeStagedAttachmentIndexFlight = (
  attachmentDirectory: string,
): StagedAttachmentIndexFlight => ({
  attachmentDirectory,
  deferred: Deferred.unsafeMake(FiberId.none),
  pendingAttachments: [],
});
const sanitizeAttachmentFilename = (name: string): string => {
  const sanitized = [...name]
    .map((character) => {
      if (`/\\:\0*?"<>|%`.includes(character)) {
        return "_";
      }
      if (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) {
        return "_";
      }
      return character;
    })
    .join("");
  const trimmed = sanitized.trim().replace(/^\.+|\.+$/g, "");
  return trimmed.length > 0 ? trimmed : "attachment.bin";
};
const sanitizeAttachmentLookupToken = (pathOrName: string): string => {
  const trimmed = pathOrName.trim();
  if (!trimmed) {
    throw new HostValidationError({ field: "path", message: "Attachment path is required." });
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
    throw new HostValidationError({
      field: "path",
      message: "Attachment path must be a staged attachment filename token.",
    });
  }
  return trimmed;
};
const formatAttachmentLookupDisplayName = (token: string): string => {
  const sanitized = [...token]
    .map((character) => {
      if (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) {
        return "_";
      }
      return character;
    })
    .join("");
  if (sanitized.length <= maxAttachmentLookupDisplayLength) {
    return sanitized;
  }
  return `${sanitized.slice(0, maxAttachmentLookupDisplayLength - 3)}...`;
};
const decodeBase64 = (value: string): Uint8Array => {
  const compact = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new HostValidationError({
      field: "base64Data",
      message: "Failed to decode attachment payload: invalid base64 data",
    });
  }
  return Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
};
const requireAttachmentInput = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new HostValidationError({ message: `${label} is required.` });
  }
  return trimmed;
};
const normalizeStageInput = (input: LocalAttachmentStageInput): LocalAttachmentStageInput => ({
  base64Data: requireAttachmentInput(input.base64Data, "Attachment payload"),
  name: requireAttachmentInput(input.name, "Attachment name"),
});
const isWithinDirectory = (
  localAttachmentPort: LocalAttachmentPort,
  directory: string,
  candidate: string,
): boolean => {
  const relative = localAttachmentPort.relativePath(directory, candidate);
  return (
    relative === "" || (!relative.startsWith("..") && !localAttachmentPort.isAbsolutePath(relative))
  );
};
const completeIndexLoadFlight = (
  flight: StagedAttachmentIndexFlight,
  loadIndex: Effect.Effect<StagedAttachmentIndex, HostOperationError>,
  setLoadedIndex: (index: StagedAttachmentIndex) => void,
  clearFlight: (flight: StagedAttachmentIndexFlight) => void,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(loadIndex);
    if (exit._tag === "Success") {
      setLoadedIndex(exit.value);
    }
    yield* Deferred.done(flight.deferred, exit);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        clearFlight(flight);
      }),
    ),
  );
export const createLocalAttachmentService = (
  localAttachmentPort: LocalAttachmentPort,
  attachmentIdFactory: () => string = () => crypto.randomUUID(),
): LocalAttachmentService => {
  let stagedAttachmentIndex: StagedAttachmentIndex | undefined;
  let stagedAttachmentIndexFlight: StagedAttachmentIndexFlight | undefined;
  let latestLocalModifiedTimeMs = 0;
  const nextLocalModifiedTimeMs = (): number => {
    const now = Date.now();
    latestLocalModifiedTimeMs = Math.max(now, latestLocalModifiedTimeMs + 1);
    return latestLocalModifiedTimeMs;
  };
  const addPendingStagedAttachmentsToIndex = (
    index: StagedAttachmentIndex,
    pendingAttachments: PendingStagedAttachment[],
  ): void => {
    if (pendingAttachments.length === 0) {
      return;
    }
    for (const attachment of pendingAttachments) {
      addIndexedStagedAttachment(
        index,
        readStagedAttachmentOriginalName({
          path: attachment.path,
          fileName: attachment.fileName,
        }),
        {
          entry: {
            path: attachment.path,
            fileName: attachment.fileName,
          },
          modifiedTimeMs: attachment.modifiedTimeMs,
        },
      );
    }
    pendingAttachments.length = 0;
  };
  const getStagedAttachmentIndex = (
    attachmentDirectory: string,
  ): Effect.Effect<StagedAttachmentIndex, HostOperationError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const loadedIndex =
          stagedAttachmentIndex?.attachmentDirectory === attachmentDirectory
            ? stagedAttachmentIndex
            : undefined;
        if (loadedIndex) {
          const fresh = yield* restore(
            isStagedAttachmentIndexFresh(localAttachmentPort, loadedIndex),
          );
          if (fresh && stagedAttachmentIndex === loadedIndex) {
            return loadedIndex;
          }
          if (stagedAttachmentIndex === loadedIndex) {
            stagedAttachmentIndex = undefined;
          }
        }
        const reservation = yield* Effect.sync(() => {
          if (stagedAttachmentIndex?.attachmentDirectory === attachmentDirectory) {
            return { _tag: "loaded" as const, index: stagedAttachmentIndex };
          }
          if (stagedAttachmentIndexFlight?.attachmentDirectory === attachmentDirectory) {
            return { _tag: "existing" as const, flight: stagedAttachmentIndexFlight };
          }
          const flight = makeStagedAttachmentIndexFlight(attachmentDirectory);
          stagedAttachmentIndexFlight = flight;
          return { _tag: "created" as const, flight };
        });
        if (reservation._tag === "loaded") {
          return reservation.index;
        }
        if (reservation._tag === "created") {
          yield* Effect.forkDaemon(
            completeIndexLoadFlight(
              reservation.flight,
              loadStagedAttachmentIndex(localAttachmentPort, attachmentDirectory),
              (index) => {
                addPendingStagedAttachmentsToIndex(index, reservation.flight.pendingAttachments);
                stagedAttachmentIndex = index;
              },
              (flight) => {
                if (stagedAttachmentIndexFlight === flight) {
                  stagedAttachmentIndexFlight = undefined;
                }
              },
            ),
          );
        }
        return yield* restore(Deferred.await(reservation.flight.deferred));
      }),
    );
  const addStagedAttachmentToLoadedIndex = (
    attachmentDirectory: string,
    fileName: string,
    stagedPath: string,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      if (
        stagedAttachmentIndex?.attachmentDirectory !== attachmentDirectory &&
        stagedAttachmentIndexFlight?.attachmentDirectory !== attachmentDirectory
      ) {
        return;
      }
      const modifiedTimeMs = nextLocalModifiedTimeMs();
      if (stagedAttachmentIndex?.attachmentDirectory !== attachmentDirectory) {
        stagedAttachmentIndexFlight?.pendingAttachments.push({
          fileName,
          modifiedTimeMs,
          path: stagedPath,
        });
        return;
      }
      addIndexedStagedAttachment(
        stagedAttachmentIndex,
        readStagedAttachmentOriginalName({ path: stagedPath, fileName }),
        {
          entry: { path: stagedPath, fileName },
          modifiedTimeMs,
        },
      );
    });
  return {
    stage(input) {
      return Effect.gen(function* () {
        const { name, base64Data } = yield* Effect.try({
          try: () => normalizeStageInput(input),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
        const bytes = yield* Effect.try({
          try: () => decodeBase64(base64Data),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
        const attachmentDirectory = localAttachmentPort.stageDirectory();
        yield* localAttachmentPort.ensureDirectory(attachmentDirectory);
        const fileName = `${attachmentIdFactory()}-${sanitizeAttachmentFilename(name)}`;
        const stagedPath = localAttachmentPort.joinPath(attachmentDirectory, fileName);
        yield* localAttachmentPort.writeFile(stagedPath, bytes);
        yield* addStagedAttachmentToLoadedIndex(attachmentDirectory, fileName, stagedPath);
        return { path: stagedPath };
      });
    },
    resolve(input) {
      return Effect.gen(function* () {
        const { path } = input;
        const trimmedPath = path.trim();
        const attachmentDirectory = localAttachmentPort.stageDirectory();
        if (localAttachmentPort.isAbsolutePath(trimmedPath)) {
          const canonicalDirectory = yield* localAttachmentPort
            .canonicalizePath(attachmentDirectory)
            .pipe(
              Effect.mapError(
                (error) =>
                  new HostOperationError({
                    operation: "local_attachment.resolve_stage_directory",
                    message: `Failed to resolve staged attachment directory: ${errorMessage(error)}`,
                    cause: error,
                  }),
              ),
            );
          const canonicalPath = yield* localAttachmentPort.canonicalizePath(trimmedPath).pipe(
            Effect.mapError(
              (error) =>
                new HostOperationError({
                  operation: "local_attachment.resolve_path",
                  message: `Failed to resolve staged attachment path: ${errorMessage(error)}`,
                  cause: error,
                }),
            ),
          );
          if (isWithinDirectory(localAttachmentPort, canonicalDirectory, canonicalPath)) {
            return { path: trimmedPath };
          }
          return yield* Effect.fail(
            new HostValidationError({
              message: "Attachment path is not a staged local attachment.",
              field: "path",
            }),
          );
        }
        const lookupToken = yield* Effect.try({
          try: () => sanitizeAttachmentLookupToken(trimmedPath),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
              details: {
                field: "path",
              },
            }),
        });
        const displayName = formatAttachmentLookupDisplayName(lookupToken);
        const index = yield* getStagedAttachmentIndex(attachmentDirectory);
        const match = yield* resolveIndexedStagedAttachment(
          localAttachmentPort,
          index,
          lookupToken,
          displayName,
        );
        return { path: match.entry.path };
      });
    },
  };
};
