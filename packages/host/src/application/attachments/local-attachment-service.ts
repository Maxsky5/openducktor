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
const readStagedAttachmentOriginalName = (entry: LocalAttachmentEntry): string | undefined => {
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
export const createLocalAttachmentService = (
  localAttachmentPort: LocalAttachmentPort,
  attachmentIdFactory: () => string = () => crypto.randomUUID(),
): LocalAttachmentService => ({
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
      const entries = yield* localAttachmentPort.readDirectory(attachmentDirectory).pipe(
        Effect.mapError((error) => {
          if (hasNestedNodeErrorCode(error, "ENOENT")) {
            return new HostValidationError({
              message: `No staged local attachment matches '${displayName}'.`,
              field: "path",
              cause: error,
            });
          }
          return new HostOperationError({
            operation: "local_attachment.read_stage_directory",
            message: `Failed to read attachment staging directory: ${errorMessage(error)}`,
            cause: error,
          });
        }),
      );
      const matches = entries.filter(
        (entry) => readStagedAttachmentOriginalName(entry) === lookupToken,
      );
      if (matches.length === 0) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `No staged local attachment matches '${displayName}'.`,
            field: "path",
          }),
        );
      }
      if (matches.length === 1) {
        const [match] = matches;
        if (!match) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `No staged local attachment matches '${displayName}'.`,
              field: "path",
            }),
          );
        }
        return { path: match.path };
      }
      const rankedMatches = yield* Effect.all(
        matches.map((entry) =>
          localAttachmentPort
            .modifiedTimeMs(entry.path)
            .pipe(Effect.map((modifiedTimeMs) => ({ entry, modifiedTimeMs }))),
        ),
      );
      rankedMatches.sort((left, right) => right.modifiedTimeMs - left.modifiedTimeMs);
      const [newestMatch] = rankedMatches;
      if (!newestMatch) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `No staged local attachment matches '${displayName}'.`,
            field: "path",
          }),
        );
      }
      return { path: newestMatch.entry.path };
    });
  },
});
