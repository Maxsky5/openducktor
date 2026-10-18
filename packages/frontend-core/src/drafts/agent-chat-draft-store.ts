import type { ClientStorage } from "../platform/client-storage";
import type { AttachmentStager, DeviceFileReference } from "../platform/device-file";
import { scheduleTask, type ScheduleTask } from "../lib/scheduling";
import {
  type AgentChatComposerAttachment,
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
} from "./agent-chat-composer-draft";
import {
  AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES,
  type AgentChatDraftSessionIdentity,
  type AgentChatDraftIdentity,
  cleanupExpiredAgentChatDraftStorage as cleanupExpiredDraftStorage,
  readAgentChatDraftFromStorage,
  removeAgentChatDraftFromStorage,
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "./agent-chat-draft-storage";

export type AgentChatDraftCleanupTarget = AgentChatDraftSessionIdentity & {
  taskId: string;
};

export type AgentChatDraftStoreOptions = {
  storage: ClientStorage;
  stageAttachment: AttachmentStager;
  reportPersistenceError?: (error: Error) => void;
  now?: () => Date;
  scheduleTask?: ScheduleTask;
};

/** The chat composer drafts of one host connection. */
export type AgentChatDraftStore = {
  /**
   * Returns the draft in memory, or reads it from storage. The first read from storage also
   * removes expired drafts.
   */
  hydrate(identity: AgentChatDraftIdentity, taskId: string | null): AgentChatComposerDraft;
  /** Keeps the draft in memory and schedules a write. Returns the user version for `clear`. */
  set(
    identity: AgentChatDraftIdentity,
    taskId: string | null,
    draft: AgentChatComposerDraft,
  ): number;
  readVersion(identity: AgentChatDraftIdentity): number | null;
  /**
   * Removes the draft from memory and storage. With `onlyIfVersion`, it keeps a draft that the
   * user changed after that version and returns `false`. With `throwOnStorageError`, a storage
   * failure throws and the draft stays in memory. Otherwise it reports the failure.
   */
  clear(
    identity: AgentChatDraftIdentity,
    options?: { onlyIfVersion?: number | null; throwOnStorageError?: boolean },
  ): boolean;
  /** Stages the attachments and writes the draft now. It reports a failure and does not reject. */
  flush(identity: AgentChatDraftIdentity): Promise<void>;
  /** Removes the drafts of each target. It throws one error after it tried every target. */
  clearForTargets(targets: AgentChatDraftCleanupTarget[]): void;
  cleanupExpired(): void;
  /**
   * Writes every unsaved draft now. Each write starts before the first await. Thus a page that
   * unloads next keeps each draft that has no attachment to stage. It rejects when it could not
   * save a draft. That draft stays in memory.
   */
  saveAll(): Promise<void>;
  /** Cancels pending writes. Unsaved drafts stay in memory. It sends no host command. */
  dispose(): void;
};

type StagedAttachment = {
  file: DeviceFileReference;
  path: string;
};

type DraftMemoryEntry = {
  identity: AgentChatDraftIdentity;
  taskId: string | null;
  draft: AgentChatComposerDraft;
  version: number;
  userVersion: number;
  persistedVersion: number;
  cancelMaxFlush: (() => void) | null;
  cancelTrailingFlush: (() => void) | null;
  isFlushing: boolean;
  flushPromise: Promise<void> | null;
  stagingAttachmentIds: Set<string>;
  stagedAttachmentsById: Map<string, StagedAttachment>;
  /** Why the last flush failed. A successful flush sets it to `null`. */
  saveError: Error | null;
};

const MAX_WAIT_MS = 2_000;
const TRAILING_WAIT_MS = 1_000;

const createEntry = (
  identity: AgentChatDraftIdentity,
  taskId: string | null,
  draft: AgentChatComposerDraft,
): DraftMemoryEntry => ({
  identity,
  taskId,
  draft,
  version: 0,
  userVersion: 0,
  persistedVersion: 0,
  cancelMaxFlush: null,
  cancelTrailingFlush: null,
  isFlushing: false,
  flushPromise: null,
  stagingAttachmentIds: new Set(),
  stagedAttachmentsById: new Map(),
  saveError: null,
});

const clearEntryTimers = (entry: DraftMemoryEntry): void => {
  entry.cancelMaxFlush?.();
  entry.cancelMaxFlush = null;
  entry.cancelTrailingFlush?.();
  entry.cancelTrailingFlush = null;
};

const toPathBackedAttachment = (
  attachment: AgentChatComposerAttachment,
  path: string,
): AgentChatComposerAttachment => {
  const { file: _file, previewUrl: _previewUrl, ...metadata } = attachment;
  return { ...metadata, path };
};

const preserveStagedAttachmentPaths = (
  entry: DraftMemoryEntry,
  draft: AgentChatComposerDraft,
): AgentChatComposerDraft => {
  if (!draft.attachments?.length || entry.stagedAttachmentsById.size === 0) {
    return draft;
  }

  let didPreserveStagedPath = false;
  const attachments = draft.attachments.map((attachment) => {
    if (attachment.path || !attachment.file) {
      return attachment;
    }

    const stagedAttachment = entry.stagedAttachmentsById.get(attachment.id);
    if (!stagedAttachment || stagedAttachment.file !== attachment.file) {
      return attachment;
    }

    didPreserveStagedPath = true;
    return toPathBackedAttachment(attachment, stagedAttachment.path);
  });

  return didPreserveStagedPath ? { ...draft, attachments } : draft;
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

export const createAgentChatDraftStore = ({
  storage,
  stageAttachment,
  reportPersistenceError: persistenceErrorReporter = (error) => {
    console.error(error);
  },
  now = () => new Date(),
  scheduleTask: scheduleDraftTask = scheduleTask,
}: AgentChatDraftStoreOptions): AgentChatDraftStore => {
  const draftEntries = new Map<string, DraftMemoryEntry>();
  let didRunExpiredCleanup = false;

  const reportPersistenceError = (cause: unknown): void => {
    persistenceErrorReporter(cause instanceof Error ? cause : new Error(String(cause)));
  };

  const readEntry = (identity: AgentChatDraftIdentity): DraftMemoryEntry | null =>
    draftEntries.get(toAgentChatDraftStorageKey(identity)) ?? null;

  const upsertEntry = (
    identity: AgentChatDraftIdentity,
    taskId: string | null,
    draft: AgentChatComposerDraft,
  ): DraftMemoryEntry => {
    const key = toAgentChatDraftStorageKey(identity);
    const existing = draftEntries.get(key);
    if (existing) {
      existing.taskId = taskId;
      existing.draft = preserveStagedAttachmentPaths(existing, draft);
      return existing;
    }

    const entry = createEntry(identity, taskId, draft);
    draftEntries.set(key, entry);
    return entry;
  };

  const scheduleEntryFlush = (entry: DraftMemoryEntry): void => {
    if (entry.isFlushing) return;

    if (entry.cancelMaxFlush === null) {
      entry.cancelMaxFlush = scheduleDraftTask(() => {
        void flush(entry.identity);
      }, MAX_WAIT_MS);
    }

    entry.cancelTrailingFlush?.();
    entry.cancelTrailingFlush = scheduleDraftTask(() => {
      void flush(entry.identity);
    }, TRAILING_WAIT_MS);
  };

  const stageAttachmentForEntry = async (
    entry: DraftMemoryEntry,
    attachment: AgentChatComposerAttachment,
  ): Promise<boolean> => {
    if (!attachment.file || entry.stagingAttachmentIds.has(attachment.id)) {
      return false;
    }

    entry.stagingAttachmentIds.add(attachment.id);
    try {
      const stagedPath = await stageAttachment(attachment.file);
      const currentEntry = readEntry(entry.identity);
      if (currentEntry !== entry) {
        return false;
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
        return false;
      }

      currentEntry.stagedAttachmentsById.set(attachment.id, {
        file: attachment.file,
        path: stagedPath,
      });
      currentEntry.draft = {
        ...currentEntry.draft,
        attachments: nextAttachments,
      };
      currentEntry.version += 1;
      return true;
    } finally {
      entry.stagingAttachmentIds.delete(attachment.id);
    }
  };

  const persistEntrySnapshot = async (entry: DraftMemoryEntry): Promise<void> => {
    while (true) {
      const unpersistableAttachment = findUnpersistableAttachment(entry.draft);
      if (!unpersistableAttachment) {
        break;
      }

      if (!unpersistableAttachment.file) {
        throw new Error(
          `Attachment "${unpersistableAttachment.name}" cannot be persisted because it has no local file path.`,
        );
      }

      // Read the current draft after each file because edits can change which file needs staging.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const didStage = await stageAttachmentForEntry(entry, unpersistableAttachment);
      const currentEntry = readEntry(entry.identity);
      if (currentEntry !== entry) {
        return;
      }
      if (
        !didStage &&
        findUnpersistableAttachment(currentEntry.draft)?.id === unpersistableAttachment.id
      ) {
        throw new Error(
          `Attachment "${unpersistableAttachment.name}" could not be prepared for chat draft persistence.`,
        );
      }
    }

    const version = entry.version;
    const writeResult = writeAgentChatDraftToStorage({
      storage,
      identity: entry.identity,
      taskId: entry.taskId,
      draft: entry.draft,
      updatedAt: now().toISOString(),
    });
    if (writeResult.status === "oversized") {
      throw new Error(
        `Chat draft is too large to persist (${writeResult.byteLength} bytes, maximum ${AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES} bytes).`,
      );
    }
    if (writeResult.status === "unpersistable_attachments") {
      throw new Error("Chat draft contains attachments that cannot be persisted.");
    }

    entry.persistedVersion = version;
  };

  const cleanupExpired = (): void => {
    cleanupExpiredDraftStorage({ storage, now: now() });
  };

  const cleanupExpiredOnce = (): void => {
    if (didRunExpiredCleanup) {
      return;
    }
    didRunExpiredCleanup = true;
    try {
      cleanupExpired();
    } catch (error) {
      reportPersistenceError(
        error instanceof Error
          ? error
          : new Error("Failed to clean expired chat drafts from storage.", { cause: error }),
      );
    }
  };

  const clear: AgentChatDraftStore["clear"] = (identity, options) => {
    const key = toAgentChatDraftStorageKey(identity);
    const entry = draftEntries.get(key);
    if (
      options?.onlyIfVersion !== undefined &&
      options.onlyIfVersion !== null &&
      entry &&
      entry.userVersion !== options.onlyIfVersion
    ) {
      return false;
    }

    if (options?.throwOnStorageError) {
      removeAgentChatDraftFromStorage({ storage, identity });
      if (entry) {
        clearEntryTimers(entry);
        draftEntries.delete(key);
      }
      return true;
    }

    if (entry) {
      clearEntryTimers(entry);
      draftEntries.delete(key);
    }

    try {
      removeAgentChatDraftFromStorage({ storage, identity });
    } catch (error) {
      reportPersistenceError(error);
    }

    return true;
  };

  const flush = (identity: AgentChatDraftIdentity): Promise<void> => {
    const entry = readEntry(identity);
    if (!entry) {
      return Promise.resolve();
    }

    if (entry.isFlushing) return entry.flushPromise ?? Promise.resolve();

    clearEntryTimers(entry);
    entry.isFlushing = true;
    const userVersion = entry.userVersion;
    const flushPromise = persistEntrySnapshot(entry)
      .then(() => {
        entry.saveError = null;
      })
      .catch((error) => {
        entry.saveError = error instanceof Error ? error : new Error(String(error));
        reportPersistenceError(error);
      })
      .finally(() => {
        if (readEntry(entry.identity) !== entry) {
          return;
        }
        entry.isFlushing = false;
        entry.flushPromise = null;
        const hasNewUserChanges = entry.userVersion !== userVersion;
        if (entry.saveError) {
          if (hasNewUserChanges) {
            scheduleEntryFlush(entry);
          }
          return;
        }
        if (entry.version !== entry.persistedVersion) {
          scheduleEntryFlush(entry);
        }
      });

    entry.flushPromise = flushPromise;
    return flushPromise;
  };

  const isUnsaved = (entry: DraftMemoryEntry): boolean =>
    entry.isFlushing || entry.version !== entry.persistedVersion;

  const saveAll = async (): Promise<void> => {
    const unsaved = [...draftEntries.values()].filter(isUnsaved);
    await Promise.all(unsaved.map((entry) => flush(entry.identity)));
    const failed = unsaved.filter(
      (entry) => readEntry(entry.identity) === entry && isUnsaved(entry),
    );
    const [first] = failed;
    if (!first) return;
    const drafts = failed.length === 1 ? "a chat draft" : `${failed.length} chat drafts`;
    const reason = first.saveError?.message ?? "The draft changed while it was saved. Try again.";
    throw new Error(`Could not save ${drafts}. ${reason}`, { cause: first.saveError });
  };

  return {
    hydrate: (identity, taskId) => {
      const existing = readEntry(identity);
      if (existing) {
        existing.taskId = taskId;
        return existing.draft;
      }

      cleanupExpiredOnce();

      let draft = createEmptyComposerDraft();
      try {
        const result = readAgentChatDraftFromStorage({ storage, identity, now: now() });
        if (result.status === "restored") {
          draft = result.value.draft;
        }
      } catch (error) {
        reportPersistenceError(error);
      }

      const entry = createEntry(identity, taskId, draft);
      draftEntries.set(toAgentChatDraftStorageKey(identity), entry);
      return draft;
    },
    set: (identity, taskId, draft) => {
      const entry = upsertEntry(identity, taskId, draft);
      entry.version += 1;
      entry.userVersion += 1;
      scheduleEntryFlush(entry);
      return entry.userVersion;
    },
    readVersion: (identity) => readEntry(identity)?.userVersion ?? null,
    clear,
    flush,
    clearForTargets: (targets) => {
      const uniqueIdentities = new Map<string, AgentChatDraftSessionIdentity>();
      for (const target of targets) {
        uniqueIdentities.set(toAgentChatDraftStorageKey(target), {
          workspaceId: target.workspaceId,
          externalSessionId: target.externalSessionId,
          runtimeKind: target.runtimeKind,
          workingDirectory: target.workingDirectory,
        });
      }

      const errors: Error[] = [];
      for (const identity of uniqueIdentities.values()) {
        try {
          clear(identity, { throwOnStorageError: true });
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      if (errors.length > 0) {
        throw new Error(`Failed to clean ${errors.length} chat draft storage key(s).`, {
          cause: errors[0],
        });
      }
    },
    cleanupExpired,
    saveAll,
    dispose: () => {
      for (const entry of draftEntries.values()) {
        clearEntryTimers(entry);
      }
    },
  };
};
