import type { DiffScope } from "@/features/agent-studio-git";
import { z } from "zod";
import type { InlineCommentDraft, InlineCommentSide } from "./use-inline-comment-draft-store";

export type PersistedInlineCommentDraft = Pick<
  InlineCommentDraft,
  | "id"
  | "filePath"
  | "diffScope"
  | "side"
  | "startLine"
  | "endLine"
  | "text"
  | "codeContext"
  | "language"
  | "createdAt"
>;

export type InlineCommentDraftStorageIdentity = {
  workspaceId: string;
  taskId: string;
};

export type SerializedInlineCommentDraftsResult =
  | { status: "empty" }
  | { status: "serialized"; payload: string; byteLength: number }
  | { status: "oversized"; byteLength: number };

export type InlineCommentDraftsStorageReadResult =
  | { status: "empty" }
  | { status: "restored"; comments: PersistedInlineCommentDraft[]; updatedAt: string }
  | { status: "invalid"; reason: string }
  | { status: "expired" }
  | { status: "oversized"; byteLength: number };

export type RestoredInlineCommentDraftsEntry = {
  ownerKey: string;
  comments: PersistedInlineCommentDraft[];
  updatedAt: string;
};

export const INLINE_COMMENT_DRAFT_STORAGE_PREFIX = "openducktor:git-diff-comments:v1";
export const INLINE_COMMENT_DRAFT_STORAGE_MAX_BYTES = 131_072;
export const INLINE_COMMENT_DRAFT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

const DIFF_SCOPES = ["uncommitted", "target"] as const satisfies readonly DiffScope[];
const INLINE_COMMENT_SIDES = ["old", "new"] as const satisfies readonly InlineCommentSide[];

const nonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "String must contain non-whitespace." });
const lineNumberSchema = z.number().int().positive();
const diffScopeSchema = z.enum(DIFF_SCOPES);
const sideSchema = z.enum(INLINE_COMMENT_SIDES);
const contextLineSchema = z.object({
  lineNumber: lineNumberSchema,
  text: z.string(),
  isSelected: z.boolean(),
});
const persistedCommentSchema = z
  .object({
    id: nonEmptyStringSchema,
    filePath: nonEmptyStringSchema,
    diffScope: diffScopeSchema,
    side: sideSchema,
    startLine: lineNumberSchema,
    endLine: lineNumberSchema,
    text: nonEmptyStringSchema,
    codeContext: z.array(contextLineSchema),
    language: z.string().nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .refine((comment) => comment.startLine <= comment.endLine, {
    message: "Stored git diff comment line range must be ordered.",
  });
const persistedInlineCommentDraftsPayloadSchema = z.object({
  version: z.literal(1),
  workspaceId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
  comments: z.array(persistedCommentSchema),
});

export const toInlineCommentDraftStorageKey = ({
  workspaceId,
  taskId,
}: InlineCommentDraftStorageIdentity): string =>
  `${INLINE_COMMENT_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(taskId)}`;

export const isInlineCommentDraftStorageKey = (key: string): boolean =>
  key.startsWith(`${INLINE_COMMENT_DRAFT_STORAGE_PREFIX}:`);

export const parseInlineCommentDraftStorageKey = (
  key: string,
): InlineCommentDraftStorageIdentity | null => {
  if (!isInlineCommentDraftStorageKey(key)) {
    return null;
  }

  const parts = key.slice(`${INLINE_COMMENT_DRAFT_STORAGE_PREFIX}:`.length).split(":");
  if (parts.length !== 2) {
    return null;
  }

  try {
    const workspaceId = decodeURIComponent(parts[0] ?? "");
    const taskId = decodeURIComponent(parts[1] ?? "");
    return workspaceId && taskId ? { workspaceId, taskId } : null;
  } catch {
    return null;
  }
};

export const measureInlineCommentDraftsPayloadBytes = (payload: string): number =>
  encoder.encode(payload).byteLength;

export const serializeInlineCommentDraftsPayload = ({
  ownerKey,
  comments,
  updatedAt,
}: {
  ownerKey: string;
  comments: PersistedInlineCommentDraft[];
  updatedAt: string;
}): SerializedInlineCommentDraftsResult => {
  if (comments.length === 0) {
    return { status: "empty" };
  }

  const identity = parseInlineCommentDraftStorageKey(ownerKey);
  if (!identity) {
    throw new Error(`Invalid git diff comment storage key "${ownerKey}".`);
  }

  const serialized = JSON.stringify({
    version: 1,
    workspaceId: identity.workspaceId,
    taskId: identity.taskId,
    updatedAt,
    comments,
  });
  const byteLength = measureInlineCommentDraftsPayloadBytes(serialized);
  if (byteLength > INLINE_COMMENT_DRAFT_STORAGE_MAX_BYTES) {
    return { status: "oversized", byteLength };
  }

  return { status: "serialized", payload: serialized, byteLength };
};

export const parseInlineCommentDraftsPayload = ({
  raw,
  ownerKey,
  now,
}: {
  raw: string | null;
  ownerKey: string;
  now: Date;
}): InlineCommentDraftsStorageReadResult => {
  if (raw === null) {
    return { status: "empty" };
  }

  const byteLength = measureInlineCommentDraftsPayloadBytes(raw);
  if (byteLength > INLINE_COMMENT_DRAFT_STORAGE_MAX_BYTES) {
    return { status: "oversized", byteLength };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "Stored git diff comments are not valid JSON." };
  }

  const parsed = persistedInlineCommentDraftsPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: "invalid", reason: "Stored git diff comment body is invalid." };
  }

  const payload = parsed.data;
  if (toInlineCommentDraftStorageKey(payload) !== ownerKey) {
    return {
      status: "invalid",
      reason: "Stored git diff comment identity does not match the key.",
    };
  }
  if (payload.comments.length === 0) {
    return { status: "invalid", reason: "Stored git diff comment body is empty." };
  }
  const updatedAtMs = Date.parse(payload.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return { status: "invalid", reason: "Stored git diff comment update date is invalid." };
  }
  const ageMs = now.getTime() - updatedAtMs;
  if (ageMs < 0) {
    return { status: "invalid", reason: "Stored git diff comment update date is in the future." };
  }
  if (ageMs >= INLINE_COMMENT_DRAFT_STORAGE_TTL_MS) {
    return { status: "expired" };
  }

  return { status: "restored", comments: payload.comments, updatedAt: payload.updatedAt };
};

const readStoragePayload = (storage: Pick<Storage, "getItem">, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw new Error(`Failed to read git diff comment storage key "${key}".`, { cause });
  }
};

const removeStoragePayload = (storage: Pick<Storage, "removeItem">, key: string): void => {
  try {
    storage.removeItem(key);
  } catch (cause) {
    throw new Error(`Failed to remove git diff comment storage key "${key}".`, { cause });
  }
};

export const writeInlineCommentDraftsToStorage = ({
  storage,
  ownerKey,
  comments,
  updatedAt,
}: {
  storage: Pick<Storage, "setItem" | "removeItem">;
  ownerKey: string;
  comments: PersistedInlineCommentDraft[];
  updatedAt: string;
}): SerializedInlineCommentDraftsResult => {
  const result = serializeInlineCommentDraftsPayload({ ownerKey, comments, updatedAt });
  if (result.status !== "serialized") {
    removeStoragePayload(storage, ownerKey);
    return result;
  }

  try {
    storage.setItem(ownerKey, result.payload);
  } catch (cause) {
    throw new Error(`Failed to persist git diff comment storage key "${ownerKey}".`, { cause });
  }

  return result;
};

export const readInlineCommentDraftsFromStorage = ({
  storage,
  ownerKey,
  now = new Date(),
}: {
  storage: Pick<Storage, "getItem" | "removeItem">;
  ownerKey: string;
  now?: Date;
}): InlineCommentDraftsStorageReadResult => {
  const raw = readStoragePayload(storage, ownerKey);
  const result = parseInlineCommentDraftsPayload({ raw, ownerKey, now });
  if (result.status === "invalid" || result.status === "expired" || result.status === "oversized") {
    removeStoragePayload(storage, ownerKey);
  }
  return result;
};

export const readAllInlineCommentDraftsFromStorage = ({
  storage,
  now = new Date(),
}: {
  storage: Pick<Storage, "length" | "key" | "getItem" | "removeItem">;
  now?: Date;
}): RestoredInlineCommentDraftsEntry[] => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isInlineCommentDraftStorageKey(key)) {
      keys.push(key);
    }
  }

  const entries: RestoredInlineCommentDraftsEntry[] = [];
  for (const key of keys) {
    if (!parseInlineCommentDraftStorageKey(key)) {
      removeStoragePayload(storage, key);
      continue;
    }

    const result = readInlineCommentDraftsFromStorage({ storage, ownerKey: key, now });
    if (result.status === "restored") {
      entries.push({ ownerKey: key, comments: result.comments, updatedAt: result.updatedAt });
    }
  }

  return entries;
};
