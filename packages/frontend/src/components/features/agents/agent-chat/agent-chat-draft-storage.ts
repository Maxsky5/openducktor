import {
  runtimeKindSchema,
  skillDescriptorSchema,
  slashCommandDescriptorSchema,
  subagentDescriptorSchema,
} from "@openducktor/contracts";
import type { AgentAttachmentKind } from "@openducktor/core";
import { z } from "zod";
import {
  type AgentSessionIdentityLike,
  agentSessionIdentityKey,
  parseAgentSessionIdentityKey,
} from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { buildComposerAttachmentFromPath } from "./agent-chat-attachments";
import {
  type AgentChatComposerAttachment,
  type AgentChatComposerDraft,
  type AgentChatComposerSegment,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";

export type AgentChatDraftSessionIdentity = AgentSessionIdentityLike & {
  workspaceId: string;
};

export type PersistedAgentChatDraftAttachment = {
  id: string;
  path: string;
  name: string;
  kind: AgentAttachmentKind;
  mime?: string;
};

export type PersistedAgentChatDraftPayload = {
  version: 2;
  workspaceId: string;
  externalSessionId: string;
  runtimeKind: AgentChatDraftSessionIdentity["runtimeKind"];
  workingDirectory: string;
  taskId: string;
  updatedAt: string;
  draft: {
    segments: AgentChatComposerSegment[];
    attachments: PersistedAgentChatDraftAttachment[];
  };
};

export type SerializedAgentChatDraftResult =
  | { status: "empty" }
  | { status: "unpersistable_attachments" }
  | { status: "oversized"; byteLength: number }
  | { status: "serialized"; payload: string; byteLength: number };

export type RestoredAgentChatDraft = {
  taskId: string;
  updatedAt: string;
  draft: AgentChatComposerDraft;
};

export type AgentChatDraftStorageReadResult =
  | { status: "empty" }
  | { status: "restored"; value: RestoredAgentChatDraft }
  | { status: "invalid"; reason: string }
  | { status: "expired" }
  | { status: "oversized"; byteLength: number };

export const AGENT_CHAT_DRAFT_STORAGE_PREFIX = "openducktor:agent-chat:draft:v2";
const LEGACY_AGENT_CHAT_DRAFT_STORAGE_PREFIX = "openducktor:agent-chat:draft:v1";
export const AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES = 20_480;
export const AGENT_CHAT_DRAFT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const ATTACHMENT_KINDS = ["image", "audio", "video", "pdf"] as const;
const FILE_REFERENCE_KINDS = ["directory", "css", "code", "image", "video", "default"] as const;

const nonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "String must contain non-whitespace." });
const attachmentKindSchema = z.enum(ATTACHMENT_KINDS);
const fileReferenceKindSchema = z.enum(FILE_REFERENCE_KINDS);
const attachmentSchema = z.object({
  id: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: attachmentKindSchema,
  mime: z.string().optional(),
});
const fileReferenceSchema = z.object({
  id: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: fileReferenceKindSchema,
});
const textSegmentSchema = z.object({
  id: nonEmptyStringSchema,
  kind: z.literal("text"),
  text: z.string(),
});
const slashCommandSegmentSchema = z.object({
  id: nonEmptyStringSchema,
  kind: z.literal("slash_command"),
  command: slashCommandDescriptorSchema,
});
const fileReferenceSegmentSchema = z.object({
  id: nonEmptyStringSchema,
  kind: z.literal("file_reference"),
  file: fileReferenceSchema,
});
const skillReferenceSegmentSchema = z.object({
  id: nonEmptyStringSchema,
  kind: z.literal("skill_mention"),
  skill: skillDescriptorSchema,
});
const subagentReferenceSegmentSchema = z.object({
  id: nonEmptyStringSchema,
  kind: z.literal("subagent_reference"),
  subagent: subagentDescriptorSchema,
});
const persistedSegmentSchema = z.discriminatedUnion("kind", [
  textSegmentSchema,
  slashCommandSegmentSchema,
  fileReferenceSegmentSchema,
  skillReferenceSegmentSchema,
  subagentReferenceSegmentSchema,
]);
const persistedAgentChatDraftPayloadSchema = z.object({
  version: z.literal(2),
  workspaceId: nonEmptyStringSchema,
  externalSessionId: nonEmptyStringSchema,
  runtimeKind: runtimeKindSchema,
  workingDirectory: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
  draft: z.object({
    segments: z.array(persistedSegmentSchema),
    attachments: z.array(attachmentSchema),
  }),
});

export const toAgentChatDraftStorageKey = (identity: AgentChatDraftSessionIdentity): string =>
  `${AGENT_CHAT_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(
    identity.workspaceId,
  )}:${agentSessionIdentityKey(identity)}`;

export const isAgentChatDraftStorageKey = (key: string): boolean =>
  key.startsWith(`${AGENT_CHAT_DRAFT_STORAGE_PREFIX}:`) ||
  key.startsWith(`${LEGACY_AGENT_CHAT_DRAFT_STORAGE_PREFIX}:`);

export const measureAgentChatDraftPayloadBytes = (payload: string): number =>
  encoder.encode(payload).byteLength;

const toPersistedAttachment = (
  attachment: AgentChatComposerAttachment,
): PersistedAgentChatDraftAttachment | null => {
  if (!attachment.path) {
    return null;
  }

  const persistedAttachment: PersistedAgentChatDraftAttachment = {
    id: attachment.id,
    path: attachment.path,
    name: attachment.name,
    kind: attachment.kind,
  };
  if (attachment.mime) persistedAttachment.mime = attachment.mime;
  return persistedAttachment;
};

export const serializeAgentChatDraftPayload = ({
  identity,
  taskId,
  draft,
  updatedAt,
}: {
  identity: AgentChatDraftSessionIdentity;
  taskId: string;
  draft: AgentChatComposerDraft;
  updatedAt: string;
}): SerializedAgentChatDraftResult => {
  if (!draftHasMeaningfulContent(draft)) {
    return { status: "empty" };
  }

  const attachments: PersistedAgentChatDraftAttachment[] = [];
  for (const attachment of draft.attachments ?? []) {
    const persistedAttachment = toPersistedAttachment(attachment);
    if (!persistedAttachment) {
      return { status: "unpersistable_attachments" };
    }
    attachments.push(persistedAttachment);
  }

  const payload: PersistedAgentChatDraftPayload = {
    version: 2,
    workspaceId: identity.workspaceId,
    externalSessionId: identity.externalSessionId,
    runtimeKind: identity.runtimeKind,
    workingDirectory: normalizeWorkingDirectory(identity.workingDirectory),
    taskId,
    updatedAt,
    draft: {
      segments: draft.segments,
      attachments,
    },
  };
  const serialized = JSON.stringify(payload);
  const byteLength = measureAgentChatDraftPayloadBytes(serialized);
  if (byteLength > AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES) {
    return { status: "oversized", byteLength };
  }

  return { status: "serialized", payload: serialized, byteLength };
};

const parseAttachment = (
  value: z.infer<typeof attachmentSchema>,
): AgentChatComposerAttachment | null => {
  const metadata: NonNullable<Parameters<typeof buildComposerAttachmentFromPath>[1]> = {
    name: value.name,
    kind: value.kind,
  };
  if (value.mime) metadata.mime = value.mime;
  const attachment = buildComposerAttachmentFromPath(value.path, metadata);
  return attachment ? { ...attachment, id: value.id } : null;
};

export const parseAgentChatDraftPayload = ({
  raw,
  identity,
  now,
}: {
  raw: string | null;
  identity: AgentChatDraftSessionIdentity;
  now: Date;
}): AgentChatDraftStorageReadResult => {
  if (!raw) {
    return { status: "empty" };
  }

  const byteLength = measureAgentChatDraftPayloadBytes(raw);
  if (byteLength > AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES) {
    return { status: "oversized", byteLength };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "Stored chat draft is not valid JSON." };
  }

  const parsed = persistedAgentChatDraftPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: "invalid", reason: "Stored chat draft body is invalid." };
  }

  const payload = parsed.data;
  const parsedIdentity: AgentChatDraftSessionIdentity = {
    workspaceId: payload.workspaceId,
    externalSessionId: payload.externalSessionId,
    runtimeKind: payload.runtimeKind,
    workingDirectory: payload.workingDirectory,
  };
  if (
    parsedIdentity.workspaceId !== identity.workspaceId ||
    agentSessionIdentityKey(parsedIdentity) !== agentSessionIdentityKey(identity)
  ) {
    return { status: "invalid", reason: "Stored chat draft identity does not match the key." };
  }
  const updatedAtMs = Date.parse(payload.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return { status: "invalid", reason: "Stored chat draft update date is invalid." };
  }
  const ageMs = now.getTime() - updatedAtMs;
  if (ageMs < 0) {
    return { status: "invalid", reason: "Stored chat draft update date is in the future." };
  }
  if (ageMs >= AGENT_CHAT_DRAFT_STORAGE_TTL_MS) {
    return { status: "expired" };
  }

  const segments: AgentChatComposerSegment[] = [];
  for (const segment of payload.draft.segments) {
    segments.push(segment);
  }

  const attachments: AgentChatComposerAttachment[] = [];
  for (const attachmentValue of payload.draft.attachments) {
    const attachment = parseAttachment(attachmentValue);
    if (!attachment) {
      return { status: "invalid", reason: "Stored chat draft contains an invalid attachment." };
    }
    attachments.push(attachment);
  }

  return {
    status: "restored",
    value: {
      taskId: payload.taskId,
      updatedAt: payload.updatedAt,
      draft: { segments, attachments },
    },
  };
};

const readDraftStoragePayload = (storage: Pick<Storage, "getItem">, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw new Error(`Failed to read chat draft storage key "${key}".`, { cause });
  }
};

const removeDraftStoragePayload = (storage: Pick<Storage, "removeItem">, key: string): void => {
  try {
    storage.removeItem(key);
  } catch (cause) {
    throw new Error(`Failed to remove chat draft storage key "${key}".`, { cause });
  }
};

const decodeDraftKeyPart = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const parseDraftStorageKeyIdentity = (key: string): AgentChatDraftSessionIdentity | null => {
  const keyPrefix = `${AGENT_CHAT_DRAFT_STORAGE_PREFIX}:`;
  if (!key.startsWith(keyPrefix)) {
    return null;
  }

  const suffix = key.slice(keyPrefix.length);
  const workspaceSeparatorIndex = suffix.indexOf(":");
  if (workspaceSeparatorIndex === -1) {
    return null;
  }

  const workspaceId = decodeDraftKeyPart(suffix.slice(0, workspaceSeparatorIndex));
  const sessionIdentity = parseAgentSessionIdentityKey(suffix.slice(workspaceSeparatorIndex + 1));
  if (!workspaceId || !sessionIdentity) {
    return null;
  }

  return {
    workspaceId,
    ...sessionIdentity,
  };
};

export const writeAgentChatDraftToStorage = ({
  storage,
  identity,
  taskId,
  draft,
  updatedAt,
}: {
  storage: Pick<Storage, "setItem" | "removeItem">;
  identity: AgentChatDraftSessionIdentity;
  taskId: string;
  draft: AgentChatComposerDraft;
  updatedAt: string;
}): SerializedAgentChatDraftResult => {
  const key = toAgentChatDraftStorageKey(identity);
  const result = serializeAgentChatDraftPayload({ identity, taskId, draft, updatedAt });
  if (result.status !== "serialized") {
    removeDraftStoragePayload(storage, key);
    return result;
  }

  try {
    storage.setItem(key, result.payload);
  } catch (cause) {
    throw new Error(`Failed to persist chat draft storage key "${key}".`, { cause });
  }

  return result;
};

export const readAgentChatDraftFromStorage = ({
  storage,
  identity,
  now = new Date(),
}: {
  storage: Pick<Storage, "getItem" | "removeItem">;
  identity: AgentChatDraftSessionIdentity;
  now?: Date;
}): AgentChatDraftStorageReadResult => {
  const key = toAgentChatDraftStorageKey(identity);
  const raw = readDraftStoragePayload(storage, key);
  const result = parseAgentChatDraftPayload({ raw, identity, now });
  if (result.status === "invalid" || result.status === "expired" || result.status === "oversized") {
    removeDraftStoragePayload(storage, key);
  }
  return result;
};

export const removeAgentChatDraftFromStorage = ({
  storage,
  identity,
}: {
  storage: Pick<Storage, "removeItem">;
  identity: AgentChatDraftSessionIdentity;
}): void => {
  removeDraftStoragePayload(storage, toAgentChatDraftStorageKey(identity));
};

export const cleanupExpiredAgentChatDraftStorage = ({
  storage,
  now = new Date(),
}: {
  storage: Pick<Storage, "length" | "key" | "getItem" | "removeItem">;
  now?: Date;
}): void => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isAgentChatDraftStorageKey(key)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    if (key.startsWith(`${LEGACY_AGENT_CHAT_DRAFT_STORAGE_PREFIX}:`)) {
      removeDraftStoragePayload(storage, key);
      continue;
    }

    const raw = readDraftStoragePayload(storage, key);
    const identity = parseDraftStorageKeyIdentity(key);
    if (!identity) {
      removeDraftStoragePayload(storage, key);
      continue;
    }

    const result = parseAgentChatDraftPayload({
      raw,
      identity,
      now,
    });
    if (
      result.status === "invalid" ||
      result.status === "expired" ||
      result.status === "oversized"
    ) {
      removeDraftStoragePayload(storage, key);
    }
  }
};
