import { stageLocalAttachmentFile } from "@/lib/local-attachment-files";
import {
  type AgentChatComposerAttachment,
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
} from "./agent-chat-composer-draft";
import {
  type AgentChatDraftSessionIdentity,
  cleanupExpiredAgentChatDraftStorage as cleanupExpiredDraftStorage,
  readAgentChatDraftFromStorage,
  removeAgentChatDraftFromStorage,
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "./agent-chat-draft-storage";

type DraftTimerId = ReturnType<typeof globalThis.setTimeout>;
type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type AttachmentStager = (file: File) => Promise<string>;
type PersistenceErrorReporter = (error: Error) => void;

type DraftMemoryEntry = {
  identity: AgentChatDraftSessionIdentity;
  taskId: string;
  draft: AgentChatComposerDraft;
  version: number;
  persistedVersion: number;
  maxTimeoutId: DraftTimerId | null;
  trailingTimeoutId: DraftTimerId | null;
  isFlushing: boolean;
  flushRequestedAfterCurrent: boolean;
  flushPromise: Promise<void> | null;
  stagingAttachmentIds: Set<string>;
};

export type AgentChatDraftCleanupTarget = AgentChatDraftSessionIdentity & {
  taskId: string;
};

const MAX_WAIT_MS = 2_000;
const TRAILING_WAIT_MS = 1_000;
const draftEntries = new Map<string, DraftMemoryEntry>();

let storageOverride: DraftStorage | null = null;
let attachmentStager: AttachmentStager = stageLocalAttachmentFile;
let nowProvider = (): Date => new Date();
let persistenceErrorReporter: PersistenceErrorReporter = (error) => {
  console.error(error);
};

const getDraftStorage = (): DraftStorage => {
  if (storageOverride) {
    return storageOverride;
  }
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("Chat draft persistence is unavailable because localStorage is missing.");
  }
  return globalThis.localStorage;
};

const reportPersistenceError = (error: unknown): void => {
  persistenceErrorReporter(error instanceof Error ? error : new Error(String(error)));
};

const createEntry = (
  identity: AgentChatDraftSessionIdentity,
  taskId: string,
  draft: AgentChatComposerDraft,
): DraftMemoryEntry => ({
  identity,
  taskId,
  draft,
  version: 0,
  persistedVersion: 0,
  maxTimeoutId: null,
  trailingTimeoutId: null,
  isFlushing: false,
  flushRequestedAfterCurrent: false,
  flushPromise: null,
  stagingAttachmentIds: new Set(),
});

const clearEntryTimers = (entry: DraftMemoryEntry): void => {
  if (entry.maxTimeoutId !== null) {
    globalThis.clearTimeout(entry.maxTimeoutId);
    entry.maxTimeoutId = null;
  }
  if (entry.trailingTimeoutId !== null) {
    globalThis.clearTimeout(entry.trailingTimeoutId);
    entry.trailingTimeoutId = null;
  }
};

const readEntry = (identity: AgentChatDraftSessionIdentity): DraftMemoryEntry | null =>
  draftEntries.get(toAgentChatDraftStorageKey(identity)) ?? null;

const upsertEntry = (
  identity: AgentChatDraftSessionIdentity,
  taskId: string,
  draft: AgentChatComposerDraft,
): DraftMemoryEntry => {
  const key = toAgentChatDraftStorageKey(identity);
  const existing = draftEntries.get(key);
  if (existing) {
    existing.taskId = taskId;
    existing.draft = draft;
    return existing;
  }

  const entry = createEntry(identity, taskId, draft);
  draftEntries.set(key, entry);
  return entry;
};

const scheduleEntryFlush = (entry: DraftMemoryEntry): void => {
  if (entry.isFlushing) {
    entry.flushRequestedAfterCurrent = true;
    return;
  }

  if (entry.maxTimeoutId === null) {
    entry.maxTimeoutId = globalThis.setTimeout(() => {
      void flushAgentChatDraft(entry.identity);
    }, MAX_WAIT_MS);
  }

  if (entry.trailingTimeoutId !== null) {
    globalThis.clearTimeout(entry.trailingTimeoutId);
  }
  entry.trailingTimeoutId = globalThis.setTimeout(() => {
    void flushAgentChatDraft(entry.identity);
  }, TRAILING_WAIT_MS);
};

const toPathBackedAttachment = (
  attachment: AgentChatComposerAttachment,
  path: string,
): AgentChatComposerAttachment => {
  const { file: _file, previewUrl: _previewUrl, ...metadata } = attachment;
  return { ...metadata, path };
};

const findUnpersistableAttachment = (
  draft: AgentChatComposerDraft,
): AgentChatComposerAttachment | null => {
  for (const attachment of draft.attachments ?? []) {
    if (!attachment.path) {
      return attachment;
    }
  }
  return null;
};

const stageAttachmentForEntry = async (
  entry: DraftMemoryEntry,
  attachment: AgentChatComposerAttachment,
): Promise<void> => {
  if (!attachment.file || entry.stagingAttachmentIds.has(attachment.id)) {
    return;
  }

  entry.stagingAttachmentIds.add(attachment.id);
  try {
    const stagedPath = await attachmentStager(attachment.file);
    const currentEntry = readEntry(entry.identity);
    if (!currentEntry) {
      return;
    }

    let didUpdateAttachment = false;
    const nextAttachments = (currentEntry.draft.attachments ?? []).map((currentAttachment) => {
      if (
        currentAttachment.id !== attachment.id ||
        currentAttachment.path ||
        currentAttachment.file !== attachment.file
      ) {
        return currentAttachment;
      }

      didUpdateAttachment = true;
      return toPathBackedAttachment(currentAttachment, stagedPath);
    });

    if (!didUpdateAttachment) {
      return;
    }

    currentEntry.draft = {
      ...currentEntry.draft,
      attachments: nextAttachments,
    };
    currentEntry.version += 1;
    scheduleEntryFlush(currentEntry);
  } catch (error) {
    reportPersistenceError(
      error instanceof Error
        ? error
        : new Error(`Failed to stage chat draft attachment "${attachment.name}".`),
    );
  } finally {
    entry.stagingAttachmentIds.delete(attachment.id);
  }
};

const persistEntrySnapshot = async (entry: DraftMemoryEntry, version: number): Promise<void> => {
  const storage = getDraftStorage();
  const unpersistableAttachment = findUnpersistableAttachment(entry.draft);
  if (unpersistableAttachment) {
    removeAgentChatDraftFromStorage({ storage, identity: entry.identity });
    entry.persistedVersion = version;
    if (!unpersistableAttachment.file) {
      reportPersistenceError(
        new Error(
          `Attachment "${unpersistableAttachment.name}" cannot be persisted because it has no local file path.`,
        ),
      );
      return;
    }
    await stageAttachmentForEntry(entry, unpersistableAttachment);
    return;
  }

  writeAgentChatDraftToStorage({
    storage,
    identity: entry.identity,
    taskId: entry.taskId,
    draft: entry.draft,
    updatedAt: nowProvider().toISOString(),
  });
  entry.persistedVersion = version;
};

export const hydrateAgentChatDraft = (
  identity: AgentChatDraftSessionIdentity,
  taskId: string,
): AgentChatComposerDraft => {
  const existing = readEntry(identity);
  if (existing) {
    existing.taskId = taskId;
    return existing.draft;
  }

  let draft = createEmptyComposerDraft();
  try {
    const result = readAgentChatDraftFromStorage({
      storage: getDraftStorage(),
      identity,
      now: nowProvider(),
    });
    if (result.status === "restored") {
      draft = result.value.draft;
    }
  } catch (error) {
    reportPersistenceError(error);
  }

  const entry = createEntry(identity, taskId, draft);
  draftEntries.set(toAgentChatDraftStorageKey(identity), entry);
  return draft;
};

export const setAgentChatDraft = (
  identity: AgentChatDraftSessionIdentity,
  taskId: string,
  draft: AgentChatComposerDraft,
): number => {
  const entry = upsertEntry(identity, taskId, draft);
  entry.version += 1;
  scheduleEntryFlush(entry);
  return entry.version;
};

export const readAgentChatDraftVersion = (identity: AgentChatDraftSessionIdentity): number | null =>
  readEntry(identity)?.version ?? null;

export const clearAgentChatDraft = (
  identity: AgentChatDraftSessionIdentity,
  options?: {
    onlyIfVersion?: number | null;
    throwOnStorageError?: boolean;
  },
): boolean => {
  const key = toAgentChatDraftStorageKey(identity);
  const entry = draftEntries.get(key);
  if (
    typeof options?.onlyIfVersion === "number" &&
    entry &&
    entry.version !== options.onlyIfVersion
  ) {
    return false;
  }

  if (entry) {
    clearEntryTimers(entry);
    draftEntries.delete(key);
  }

  try {
    removeAgentChatDraftFromStorage({ storage: getDraftStorage(), identity });
  } catch (error) {
    if (options?.throwOnStorageError) {
      throw error;
    }
    reportPersistenceError(error);
  }

  return true;
};

export const flushAgentChatDraft = (identity: AgentChatDraftSessionIdentity): Promise<void> => {
  const entry = readEntry(identity);
  if (!entry) {
    return Promise.resolve();
  }

  if (entry.isFlushing) {
    entry.flushRequestedAfterCurrent = true;
    return entry.flushPromise ?? Promise.resolve();
  }

  clearEntryTimers(entry);
  entry.isFlushing = true;
  entry.flushRequestedAfterCurrent = false;
  const version = entry.version;
  const flushPromise = persistEntrySnapshot(entry, version)
    .catch((error) => {
      entry.persistedVersion = version;
      reportPersistenceError(error);
    })
    .finally(() => {
      entry.isFlushing = false;
      entry.flushPromise = null;
      if (entry.version !== entry.persistedVersion || entry.flushRequestedAfterCurrent) {
        entry.flushRequestedAfterCurrent = false;
        scheduleEntryFlush(entry);
      }
    });

  entry.flushPromise = flushPromise;
  return flushPromise;
};

export const flushAllAgentChatDrafts = async (): Promise<void> => {
  await Promise.all(
    Array.from(draftEntries.values(), (entry) => flushAgentChatDraft(entry.identity)),
  );
};

export const clearAgentChatDraftsForTargets = (targets: AgentChatDraftCleanupTarget[]): void => {
  const uniqueIdentities = new Map<string, AgentChatDraftSessionIdentity>();
  for (const target of targets) {
    uniqueIdentities.set(toAgentChatDraftStorageKey(target), {
      workspaceId: target.workspaceId,
      externalSessionId: target.externalSessionId,
    });
  }

  const errors: Error[] = [];
  for (const identity of uniqueIdentities.values()) {
    try {
      clearAgentChatDraft(identity, { throwOnStorageError: true });
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to clean ${errors.length} chat draft storage key(s).`, {
      cause: errors[0],
    });
  }
};

export const cleanupExpiredAgentChatDrafts = (): void => {
  cleanupExpiredDraftStorage({ storage: getDraftStorage(), now: nowProvider() });
};

export const setAgentChatDraftPersistenceErrorReporter = (
  reporter: PersistenceErrorReporter,
): void => {
  persistenceErrorReporter = reporter;
};

export const setAgentChatDraftStorageForTests = (storage: DraftStorage | null): void => {
  storageOverride = storage;
};

export const setAgentChatDraftAttachmentStagerForTests = (
  stager: AttachmentStager | null,
): void => {
  attachmentStager = stager ?? stageLocalAttachmentFile;
};

export const setAgentChatDraftNowProviderForTests = (provider: (() => Date) | null): void => {
  nowProvider = provider ?? (() => new Date());
};

export const resetAgentChatDraftStoreForTests = (): void => {
  for (const entry of draftEntries.values()) {
    clearEntryTimers(entry);
  }
  draftEntries.clear();
  storageOverride = null;
  attachmentStager = stageLocalAttachmentFile;
  nowProvider = () => new Date();
  persistenceErrorReporter = (error) => {
    console.error(error);
  };
};
