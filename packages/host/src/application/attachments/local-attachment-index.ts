import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { LocalAttachmentEntry, LocalAttachmentPort } from "../../ports/local-attachment-port";

const uuidPrefixPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

export type IndexedStagedAttachment = {
  entry: LocalAttachmentEntry;
  modifiedTimeMs: number | null;
};

export type StagedAttachmentIndex = {
  attachmentDirectory: string;
  byLookupToken: Map<string, IndexedStagedAttachment[]>;
  directoryModifiedTimeMs: number | null;
};

export const readStagedAttachmentOriginalName = (entry: LocalAttachmentEntry): string => {
  const uuidPrefixMatch = uuidPrefixPattern.exec(entry.fileName);
  if (!uuidPrefixMatch) {
    return entry.fileName;
  }
  return entry.fileName.slice(uuidPrefixMatch[0].length);
};

const hasNestedNodeErrorCode = (error: unknown, code: string): boolean => {
  const visited = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    if ("code" in current && current.code === code) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
};

const createNoStagedAttachmentMatchError = (displayName: string): HostValidationError =>
  new HostValidationError({
    message: `No staged local attachment matches '${displayName}'.`,
    field: "path",
  });

const compareNewestStagedAttachmentFirst = (
  left: IndexedStagedAttachment,
  right: IndexedStagedAttachment,
): number =>
  (right.modifiedTimeMs ?? Number.NEGATIVE_INFINITY) -
  (left.modifiedTimeMs ?? Number.NEGATIVE_INFINITY);

const readStagedAttachmentDirectoryModifiedTimeMs = (
  localAttachmentPort: LocalAttachmentPort,
  attachmentDirectory: string,
): Effect.Effect<number | null, HostOperationError> =>
  localAttachmentPort.modifiedTimeMs(attachmentDirectory).pipe(
    Effect.catchAll((error) => {
      if (hasNestedNodeErrorCode(error, "ENOENT")) {
        return Effect.succeed(null);
      }
      return Effect.fail(
        new HostOperationError({
          operation: "local_attachment.stat_stage_directory",
          message: `Failed to inspect attachment staging directory: ${errorMessage(error)}`,
          cause: error,
        }),
      );
    }),
  );

export const addIndexedStagedAttachment = (
  index: StagedAttachmentIndex,
  lookupToken: string,
  attachment: IndexedStagedAttachment,
): void => {
  const matches = index.byLookupToken.get(lookupToken);
  if (!matches) {
    index.byLookupToken.set(lookupToken, [attachment]);
    return;
  }
  const existingIndex = matches.findIndex((match) => match.entry.path === attachment.entry.path);
  if (existingIndex >= 0) {
    matches[existingIndex] = attachment;
  } else {
    matches.push(attachment);
  }
  matches.sort(compareNewestStagedAttachmentFirst);
};

const removeIndexedStagedAttachment = (
  index: StagedAttachmentIndex,
  lookupToken: string,
  path: string,
): void => {
  const matches = index.byLookupToken.get(lookupToken);
  if (!matches) {
    return;
  }
  const remainingMatches = matches.filter((match) => match.entry.path !== path);
  if (remainingMatches.length === 0) {
    index.byLookupToken.delete(lookupToken);
    return;
  }
  index.byLookupToken.set(lookupToken, remainingMatches);
};

export const loadStagedAttachmentIndex = (
  localAttachmentPort: LocalAttachmentPort,
  attachmentDirectory: string,
): Effect.Effect<StagedAttachmentIndex, HostOperationError> =>
  Effect.gen(function* () {
    const directoryModifiedTimeMs = yield* readStagedAttachmentDirectoryModifiedTimeMs(
      localAttachmentPort,
      attachmentDirectory,
    );
    const entries = yield* localAttachmentPort.readDirectory(attachmentDirectory).pipe(
      Effect.catchAll((error) => {
        if (hasNestedNodeErrorCode(error, "ENOENT")) {
          return Effect.succeed([]);
        }
        return Effect.fail(
          new HostOperationError({
            operation: "local_attachment.read_stage_directory",
            message: `Failed to read attachment staging directory: ${errorMessage(error)}`,
            cause: error,
          }),
        );
      }),
    );
    const index: StagedAttachmentIndex = {
      attachmentDirectory,
      byLookupToken: new Map(),
      directoryModifiedTimeMs,
    };
    for (const entry of entries) {
      addIndexedStagedAttachment(index, readStagedAttachmentOriginalName(entry), {
        entry,
        modifiedTimeMs: null,
      });
    }
    return index;
  });

export const isStagedAttachmentIndexFresh = (
  localAttachmentPort: LocalAttachmentPort,
  index: StagedAttachmentIndex,
): Effect.Effect<boolean, HostOperationError> =>
  readStagedAttachmentDirectoryModifiedTimeMs(localAttachmentPort, index.attachmentDirectory).pipe(
    Effect.map(
      (directoryModifiedTimeMs) => directoryModifiedTimeMs === index.directoryModifiedTimeMs,
    ),
  );

export const resolveIndexedStagedAttachment = (
  localAttachmentPort: LocalAttachmentPort,
  index: StagedAttachmentIndex,
  lookupToken: string,
  displayName: string,
): Effect.Effect<IndexedStagedAttachment, HostOperationError | HostValidationError> =>
  Effect.gen(function* () {
    const matches = index.byLookupToken.get(lookupToken);
    if (!matches || matches.length === 0) {
      return yield* Effect.fail(createNoStagedAttachmentMatchError(displayName));
    }
    // Stale entries are pruned while scanning, so iterate over a stable snapshot.
    for (const match of [...matches]) {
      const exists = yield* localAttachmentPort.exists(match.entry.path).pipe(
        Effect.mapError(
          (error) =>
            new HostOperationError({
              operation: "local_attachment.verify_index_entry",
              message: `Failed to verify staged attachment index entry: ${errorMessage(error)}`,
              cause: error,
              details: { path: match.entry.path },
            }),
        ),
      );
      if (!exists) {
        removeIndexedStagedAttachment(index, lookupToken, match.entry.path);
        continue;
      }
      if (match.modifiedTimeMs !== null) {
        continue;
      }
      const modifiedTimeMs = yield* localAttachmentPort.modifiedTimeMs(match.entry.path).pipe(
        Effect.catchAll((error) => {
          if (hasNestedNodeErrorCode(error, "ENOENT")) {
            removeIndexedStagedAttachment(index, lookupToken, match.entry.path);
            return Effect.succeed(null);
          }
          return Effect.fail(
            new HostOperationError({
              operation: "local_attachment.stat_staged_attachment",
              message: `Failed to inspect staged attachment entry: ${errorMessage(error)}`,
              cause: error,
              details: { path: match.entry.path },
            }),
          );
        }),
      );
      if (modifiedTimeMs !== null) {
        match.modifiedTimeMs = modifiedTimeMs;
      }
    }
    const refreshedMatches = index.byLookupToken.get(lookupToken);
    if (!refreshedMatches || refreshedMatches.length === 0) {
      return yield* Effect.fail(createNoStagedAttachmentMatchError(displayName));
    }
    refreshedMatches.sort(compareNewestStagedAttachmentFirst);
    const newestMatch = refreshedMatches[0];
    if (!newestMatch) {
      return yield* Effect.fail(createNoStagedAttachmentMatchError(displayName));
    }
    return newestMatch;
  });
