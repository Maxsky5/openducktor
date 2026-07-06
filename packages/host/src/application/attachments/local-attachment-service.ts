import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { LocalAttachmentEntry, LocalAttachmentPort } from "../../ports/local-attachment-port";

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
const uuidPrefixPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
export type LocalAttachmentStageInput = {
  base64Data: string;
  name: string;
};
export type LocalAttachmentResolveInput = {
  path: string;
};
type IndexedStagedAttachment = {
  entry: LocalAttachmentEntry;
  modifiedTimeMs: number;
};
type StagedAttachmentIndex = {
  attachmentDirectory: string;
  byLookupToken: Map<string, IndexedStagedAttachment[]>;
};
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
const readStagedAttachmentOriginalName = (entry: LocalAttachmentEntry): string => {
  if (entry.fileName.length <= 37) {
    return entry.fileName;
  }
  if (!uuidPrefixPattern.test(entry.fileName)) {
    return entry.fileName;
  }
  return entry.fileName.slice(37);
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
const hasNestedNodeErrorCode = (error: unknown, code: string): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (
    "code" in error &&
    (
      error as {
        code?: unknown;
      }
    ).code === code
  ) {
    return true;
  }
  return (
    "cause" in error &&
    hasNestedNodeErrorCode(
      (
        error as {
          cause?: unknown;
        }
      ).cause,
      code,
    )
  );
};
const createNoStagedAttachmentMatchError = (displayName: string): HostValidationError =>
  new HostValidationError({
    message: `No staged local attachment matches '${displayName}'.`,
    field: "path",
  });
const compareNewestStagedAttachmentFirst = (
  left: IndexedStagedAttachment,
  right: IndexedStagedAttachment,
): number => right.modifiedTimeMs - left.modifiedTimeMs;
const addIndexedStagedAttachment = (
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
const loadStagedAttachmentIndex = (
  localAttachmentPort: LocalAttachmentPort,
  attachmentDirectory: string,
): Effect.Effect<StagedAttachmentIndex, HostOperationError> =>
  Effect.gen(function* () {
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
    };
    const indexedAttachments = yield* Effect.all(
      entries.map((entry) =>
        localAttachmentPort
          .modifiedTimeMs(entry.path)
          .pipe(Effect.map((modifiedTimeMs) => ({ entry, modifiedTimeMs }))),
      ),
    );
    for (const attachment of indexedAttachments) {
      addIndexedStagedAttachment(
        index,
        readStagedAttachmentOriginalName(attachment.entry),
        attachment,
      );
    }
    return index;
  });
const resolveIndexedStagedAttachment = (
  localAttachmentPort: LocalAttachmentPort,
  index: StagedAttachmentIndex,
  lookupToken: string,
  displayName: string,
): Effect.Effect<IndexedStagedAttachment, LocalAttachmentServiceError> =>
  Effect.gen(function* () {
    const matches = index.byLookupToken.get(lookupToken);
    if (!matches || matches.length === 0) {
      return yield* Effect.fail(createNoStagedAttachmentMatchError(displayName));
    }
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
      if (exists) {
        return match;
      }
      removeIndexedStagedAttachment(index, lookupToken, match.entry.path);
    }
    return yield* Effect.fail(createNoStagedAttachmentMatchError(displayName));
  });
export const createLocalAttachmentService = (
  localAttachmentPort: LocalAttachmentPort,
  attachmentIdFactory: () => string = () => crypto.randomUUID(),
): LocalAttachmentService => {
  let stagedAttachmentIndex: StagedAttachmentIndex | undefined;
  const getStagedAttachmentIndex = (
    attachmentDirectory: string,
  ): Effect.Effect<StagedAttachmentIndex, HostOperationError> =>
    Effect.gen(function* () {
      if (stagedAttachmentIndex?.attachmentDirectory === attachmentDirectory) {
        return stagedAttachmentIndex;
      }
      const index = yield* loadStagedAttachmentIndex(localAttachmentPort, attachmentDirectory);
      stagedAttachmentIndex = index;
      return index;
    });
  const addStagedAttachmentToLoadedIndex = (
    attachmentDirectory: string,
    fileName: string,
    stagedPath: string,
  ): Effect.Effect<void, HostOperationError> =>
    Effect.gen(function* () {
      if (stagedAttachmentIndex?.attachmentDirectory !== attachmentDirectory) {
        return;
      }
      const modifiedTimeMs = yield* localAttachmentPort.modifiedTimeMs(stagedPath);
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
