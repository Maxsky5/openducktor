import { runtimeKindSchema } from "@openducktor/contracts";
import type { AgentAttachmentKind } from "@openducktor/core";
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
const ATTACHMENT_KINDS = new Set<AgentAttachmentKind>(["image", "audio", "video", "pdf"]);
const FILE_REFERENCE_KINDS = new Set(["directory", "css", "code", "image", "video", "default"]);
const SLASH_COMMAND_SOURCES = new Set(["command", "mcp", "skill", "custom"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const optionalString = (value: unknown): value is string | undefined =>
  typeof value === "undefined" || typeof value === "string";

const optionalNonEmptyString = (value: unknown): value is string | undefined =>
  typeof value === "undefined" || isNonEmptyString(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

export const toAgentChatDraftStorageKey = (identity: AgentChatDraftSessionIdentity): string =>
  `${AGENT_CHAT_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(
    identity.workspaceId,
  )}:${agentSessionIdentityKey(identity)}`;

export const isAgentChatDraftStorageKey = (key: string): boolean =>
  key.startsWith(`${AGENT_CHAT_DRAFT_STORAGE_PREFIX}:`) ||
  key.startsWith(`${LEGACY_AGENT_CHAT_DRAFT_STORAGE_PREFIX}:`);

export const measureAgentChatDraftPayloadBytes = (payload: string): number =>
  encoder.encode(payload).byteLength;

const isValidSlashCommand = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.trigger) &&
    isNonEmptyString(value.title) &&
    optionalString(value.description) &&
    (typeof value.source === "undefined" ||
      (typeof value.source === "string" && SLASH_COMMAND_SOURCES.has(value.source))) &&
    (typeof value.hints === "undefined" || isStringArray(value.hints))
  );
};

const isValidFileReference = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.path) &&
    isNonEmptyString(value.name) &&
    typeof value.kind === "string" &&
    FILE_REFERENCE_KINDS.has(value.kind)
  );
};

const isValidSkillReference = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.path) &&
    optionalNonEmptyString(value.title) &&
    optionalNonEmptyString(value.displayName) &&
    optionalString(value.description) &&
    optionalString(value.color)
  );
};

const isValidSubagentReference = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    optionalNonEmptyString(value.label) &&
    optionalString(value.description)
  );
};

const toPersistedAttachment = (
  attachment: AgentChatComposerAttachment,
): PersistedAgentChatDraftAttachment | null => {
  if (!attachment.path) {
    return null;
  }

  return {
    id: attachment.id,
    path: attachment.path,
    name: attachment.name,
    kind: attachment.kind,
    ...(attachment.mime ? { mime: attachment.mime } : {}),
  };
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

const isValidSegment = (segment: unknown): segment is AgentChatComposerSegment => {
  if (!isRecord(segment) || !isNonEmptyString(segment.id)) {
    return false;
  }

  switch (segment.kind) {
    case "text":
      return typeof segment.text === "string";
    case "slash_command":
      return isValidSlashCommand(segment.command);
    case "file_reference":
      return isValidFileReference(segment.file);
    case "skill_mention":
      return isValidSkillReference(segment.skill);
    case "subagent_reference":
      return isValidSubagentReference(segment.subagent);
    default:
      return false;
  }
};

const parseAttachment = (value: unknown): AgentChatComposerAttachment | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.path) ||
    !isNonEmptyString(value.name) ||
    typeof value.kind !== "string" ||
    !ATTACHMENT_KINDS.has(value.kind as AgentAttachmentKind) ||
    !optionalString(value.mime)
  ) {
    return null;
  }

  const attachment = buildComposerAttachmentFromPath(value.path, {
    name: value.name,
    kind: value.kind as AgentAttachmentKind,
    ...(value.mime ? { mime: value.mime } : {}),
  });
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "Stored chat draft is not valid JSON." };
  }

  if (!isRecord(parsed)) {
    return { status: "invalid", reason: "Stored chat draft is not an object." };
  }
  if (parsed.version !== 2) {
    return { status: "invalid", reason: "Stored chat draft uses an unsupported version." };
  }
  if (!isNonEmptyString(parsed.workspaceId)) {
    return { status: "invalid", reason: "Stored chat draft is missing a workspace id." };
  }
  const parsedRuntimeKind = runtimeKindSchema.safeParse(parsed.runtimeKind);
  if (!parsedRuntimeKind.success) {
    return { status: "invalid", reason: "Stored chat draft runtime kind is invalid." };
  }
  if (!isNonEmptyString(parsed.workingDirectory)) {
    return { status: "invalid", reason: "Stored chat draft is missing a working directory." };
  }
  if (!isNonEmptyString(parsed.externalSessionId)) {
    return { status: "invalid", reason: "Stored chat draft is missing a session id." };
  }
  const parsedIdentity: AgentChatDraftSessionIdentity = {
    workspaceId: parsed.workspaceId,
    externalSessionId: parsed.externalSessionId,
    runtimeKind: parsedRuntimeKind.data,
    workingDirectory: parsed.workingDirectory,
  };
  if (
    parsedIdentity.workspaceId !== identity.workspaceId ||
    agentSessionIdentityKey(parsedIdentity) !== agentSessionIdentityKey(identity)
  ) {
    return { status: "invalid", reason: "Stored chat draft identity does not match the key." };
  }
  if (!isNonEmptyString(parsed.taskId)) {
    return { status: "invalid", reason: "Stored chat draft is missing a task id." };
  }
  if (!isNonEmptyString(parsed.updatedAt)) {
    return { status: "invalid", reason: "Stored chat draft is missing an update date." };
  }
  const updatedAtMs = Date.parse(parsed.updatedAt);
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
  if (!isRecord(parsed.draft) || !Array.isArray(parsed.draft.segments)) {
    return { status: "invalid", reason: "Stored chat draft body is invalid." };
  }

  const segments: AgentChatComposerSegment[] = [];
  for (const segment of parsed.draft.segments) {
    if (!isValidSegment(segment)) {
      return { status: "invalid", reason: "Stored chat draft contains an invalid segment." };
    }
    segments.push(segment);
  }

  if (!Array.isArray(parsed.draft.attachments)) {
    return { status: "invalid", reason: "Stored chat draft attachments are invalid." };
  }
  const attachments: AgentChatComposerAttachment[] = [];
  for (const attachmentValue of parsed.draft.attachments) {
    const attachment = parseAttachment(attachmentValue);
    if (!attachment) {
      return { status: "invalid", reason: "Stored chat draft contains an invalid attachment." };
    }
    attachments.push(attachment);
  }

  return {
    status: "restored",
    value: {
      taskId: parsed.taskId,
      updatedAt: parsed.updatedAt,
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
