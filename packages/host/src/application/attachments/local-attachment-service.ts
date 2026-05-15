import type { LocalAttachmentEntry, LocalAttachmentPort } from "../../ports/local-attachment-port";

export type StagedLocalAttachment = {
  path: string;
};

export type ResolvedLocalAttachment = {
  path: string;
};

export type LocalAttachmentService = {
  stage(input: LocalAttachmentStageInput): Promise<StagedLocalAttachment>;
  resolve(input: LocalAttachmentResolveInput): Promise<ResolvedLocalAttachment>;
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
    throw new Error("Attachment path is required.");
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
    throw new Error("Attachment path must be a staged attachment filename token.");
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
    throw new Error("Failed to decode attachment payload: invalid base64 data");
  }

  return Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
};

const requireAttachmentInput = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`);
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

export const createLocalAttachmentService = (
  localAttachmentPort: LocalAttachmentPort,
  attachmentIdFactory: () => string = () => crypto.randomUUID(),
): LocalAttachmentService => ({
  async stage(input) {
    const { name, base64Data } = normalizeStageInput(input);
    const bytes = decodeBase64(base64Data);
    const attachmentDirectory = localAttachmentPort.stageDirectory();
    await localAttachmentPort.ensureDirectory(attachmentDirectory);
    const fileName = `${attachmentIdFactory()}-${sanitizeAttachmentFilename(name)}`;
    const stagedPath = localAttachmentPort.joinPath(attachmentDirectory, fileName);
    await localAttachmentPort.writeFile(stagedPath, bytes);
    return { path: stagedPath };
  },
  async resolve(input) {
    const { path } = input;
    const trimmedPath = path.trim();
    const attachmentDirectory = localAttachmentPort.stageDirectory();

    if (localAttachmentPort.isAbsolutePath(trimmedPath)) {
      const canonicalDirectory = await localAttachmentPort
        .canonicalizePath(attachmentDirectory)
        .catch((error: unknown) => {
          throw new Error(`Failed to resolve staged attachment directory: ${String(error)}`);
        });
      const canonicalPath = await localAttachmentPort
        .canonicalizePath(trimmedPath)
        .catch((error: unknown) => {
          throw new Error(`Failed to resolve staged attachment path: ${String(error)}`);
        });
      if (isWithinDirectory(localAttachmentPort, canonicalDirectory, canonicalPath)) {
        return { path: trimmedPath };
      }
      throw new Error("Attachment path is not a staged local attachment.");
    }

    const lookupToken = sanitizeAttachmentLookupToken(trimmedPath);
    const displayName = formatAttachmentLookupDisplayName(lookupToken);
    const entries = await localAttachmentPort
      .readDirectory(attachmentDirectory)
      .catch((error: unknown) => {
        const nodeError = error as { code?: string };
        if (nodeError.code === "ENOENT") {
          throw new Error(`No staged local attachment matches '${displayName}'.`);
        }
        throw new Error(`Failed to read attachment staging directory: ${String(error)}`);
      });
    const matches = entries.filter(
      (entry) => readStagedAttachmentOriginalName(entry) === lookupToken,
    );
    if (matches.length === 0) {
      throw new Error(`No staged local attachment matches '${displayName}'.`);
    }
    if (matches.length === 1) {
      const [match] = matches;
      if (!match) {
        throw new Error(`No staged local attachment matches '${displayName}'.`);
      }
      return { path: match.path };
    }

    const rankedMatches = await Promise.all(
      matches.map(async (entry) => ({
        entry,
        modifiedTimeMs: await localAttachmentPort.modifiedTimeMs(entry.path).catch(() => 0),
      })),
    );
    rankedMatches.sort((left, right) => right.modifiedTimeMs - left.modifiedTimeMs);
    const [newestMatch] = rankedMatches;
    if (!newestMatch) {
      throw new Error(`No staged local attachment matches '${displayName}'.`);
    }
    return { path: newestMatch.entry.path };
  },
});
