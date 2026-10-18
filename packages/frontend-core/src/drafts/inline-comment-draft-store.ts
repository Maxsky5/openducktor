import { createStore, type StoreApi } from "zustand/vanilla";
import type { ClientStorage } from "../platform/client-storage";
import type { InlineCommentOwner } from "./inline-comment-owner";
import type { DiffScope } from "../types/diff-scope";
import { scheduleTask, type ScheduleTask } from "../lib/scheduling";
import {
  type PersistedInlineCommentDraft,
  pruneInlineCommentDraftsFromStorage,
  readInlineCommentDraftsFromStorage,
  toInlineCommentDraftStorageKey,
  writeInlineCommentDraftsToStorage,
} from "./inline-comment-draft-storage";

export type InlineCommentSide = "old" | "new";
export type InlineCommentStatus = "pending" | "submitting";
export type InlineCommentPersistenceWarning = "oversized" | "storage_unavailable";

export type InlineCommentContextLine = {
  lineNumber: number;
  text: string;
  isSelected: boolean;
};

export type InlineCommentDraft = {
  id: string;
  filePath: string;
  diffScope: DiffScope;
  startLine: number;
  endLine: number;
  side: InlineCommentSide;
  text: string;
  codeContext: InlineCommentContextLine[];
  language: string | null;
  revision: number;
  submissionId: string | null;
  createdAt: number;
  updatedAt: number;
  status: InlineCommentStatus;
};

export type InlineCommentDraftSnapshot = Pick<InlineCommentDraft, "id" | "revision">;

type InlineCommentLineRange = Pick<InlineCommentDraft, "startLine" | "endLine">;

export type AddInlineCommentDraftInput = {
  filePath: string;
  diffScope: DiffScope;
  startLine: number;
  endLine: number;
  side: InlineCommentSide;
  text: string;
  codeContext: InlineCommentContextLine[];
  language?: string | null;
};

export type InlineCommentDraftStore = {
  draftsByOwner: Record<string, InlineCommentDraft[]>;
  persistenceWarningsByOwner: Record<string, InlineCommentPersistenceWarning>;
  hydratedOwners: Record<string, boolean>;
  addDraft: (ownerKey: string, draft: AddInlineCommentDraftInput) => string;
  updateDraft: (ownerKey: string, id: string, text: string) => void;
  removeDraft: (ownerKey: string, id: string) => void;
  getPendingDrafts: (ownerKey: string) => InlineCommentDraft[];
  beginSubmittingDrafts: (ownerKey: string, drafts: InlineCommentDraftSnapshot[]) => string | null;
  restoreSubmittingDrafts: (submissionId: string) => void;
  completeSubmittingDrafts: (submissionId: string) => void;
  dropDraftsForMissingFiles: (
    ownerKey: string,
    diffScope: DiffScope,
    presentFilePaths: ReadonlySet<string>,
  ) => void;
  getDraftCount: (ownerKey: string) => number;
  getFileDraftCount: (ownerKey: string, filePath: string, diffScope?: DiffScope) => number;
  getDraftsForFile: (
    ownerKey: string,
    filePath: string,
    diffScope?: DiffScope,
  ) => InlineCommentDraft[];
  getPersistenceWarning: (ownerKey: string) => InlineCommentPersistenceWarning | null;
  formatBatchMessage: (drafts: InlineCommentDraft[]) => string;
  formatPendingBatchMessage: (ownerKey: string) => string;
  hydrate: (ownerKey: string) => void;
  flush: () => void;
};

export type InlineCommentDraftStoreOptions = {
  storage: ClientStorage;
  reportPersistenceError?: (error: Error) => void;
  scheduleTask?: ScheduleTask;
};

/** The inline comment drafts of one host connection. */
export type InlineCommentDraftStoreApi = StoreApi<InlineCommentDraftStore> & {
  /**
   * Writes the drafts of every owner that has unsaved changes. It throws when it could not save an
   * owner. The drafts of that owner stay in memory.
   */
  saveAll(): void;
  /** Cancels pending writes and the storage cleanup. Unsaved drafts stay in memory. */
  dispose(): void;
};

type OwnerPersistenceEntry = {
  version: number;
  persistedVersion: number;
  cancelMaxFlush: (() => void) | null;
  cancelTrailingFlush: (() => void) | null;
};

const MAX_WAIT_MS = 2_000;
const TRAILING_WAIT_MS = 1_000;

const orderLines = (startLine: number, endLine: number): InlineCommentLineRange => {
  return startLine <= endLine ? { startLine, endLine } : { startLine: endLine, endLine: startLine };
};

const matchesRevision = (
  draft: InlineCommentDraft,
  snapshot: InlineCommentDraftSnapshot,
): boolean => draft.id === snapshot.id && draft.revision === snapshot.revision;

const compareDrafts = (left: InlineCommentDraft, right: InlineCommentDraft): number => {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.diffScope.localeCompare(right.diffScope) ||
    left.side.localeCompare(right.side) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  );
};

const formatSelectedCodeLines = (codeContext: InlineCommentContextLine[]): string[] => {
  const selectedLines = codeContext.filter((line) => line.isSelected);
  const lines = (selectedLines.length > 0 ? selectedLines : codeContext).map(
    ({ lineNumber, text }) => {
      return `${lineNumber} | ${text}`;
    },
  );

  return lines;
};

const formatLineRange = (startLine: number, endLine: number): string => {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
};

const formatSelectedContextBlock = (
  codeContext: InlineCommentContextLine[],
  language: string | null,
): string => {
  const fence = language && language.length > 0 ? language : "text";
  return ["Context:", `\`\`\`${fence}`, ...formatSelectedCodeLines(codeContext), "```"].join("\n");
};

const mapCommentSideToChange = (side: InlineCommentSide): "added" | "removed" => {
  return side === "old" ? "removed" : "added";
};

const DIFF_SCOPE_LABELS = {
  uncommitted: "uncommitted changes",
  target: "branch changes",
} satisfies Record<DiffScope, string>;

const toPersistedDraft = (draft: InlineCommentDraft): PersistedInlineCommentDraft => ({
  id: draft.id,
  filePath: draft.filePath,
  diffScope: draft.diffScope,
  side: draft.side,
  startLine: draft.startLine,
  endLine: draft.endLine,
  text: draft.text,
  codeContext: draft.codeContext,
  language: draft.language,
  createdAt: draft.createdAt,
});

export const createInlineCommentDraftStore = ({
  storage,
  reportPersistenceError: persistenceErrorReporter = (error) => {
    console.error(error);
  },
  scheduleTask: schedule = scheduleTask,
}: InlineCommentDraftStoreOptions): InlineCommentDraftStoreApi => {
  const ownerEntries = new Map<string, OwnerPersistenceEntry>();
  const validatedOwnerScopes = new Set<string>();
  const missingDraftsBySubmission = new Map<
    string,
    Array<InlineCommentDraftSnapshot & { ownerKey: string }>
  >();
  let cleanupStarted = false;
  let cancelCleanup: (() => void) | null = null;
  let nextId = 0;
  let nextRevision = 0;
  let nextSubmissionId = 0;

  const generateId = (): string => `draft-${Date.now()}-${++nextId}`;
  const generateRevision = (): number => ++nextRevision;
  const generateSubmissionId = (): string => `submission-${Date.now()}-${++nextSubmissionId}`;

  const reportPersistenceError = (cause: unknown): void => {
    persistenceErrorReporter(cause instanceof Error ? cause : new Error(String(cause)));
  };

  const startCleanup = (): void => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    const cleanup = pruneInlineCommentDraftsFromStorage({ storage });
    const run = (): void => {
      cancelCleanup = null;
      try {
        if (!cleanup.next().done) cancelCleanup = schedule(run, 0);
      } catch (error) {
        reportPersistenceError(
          new Error("Failed to clean up saved Git diff comments. Check access to local storage.", {
            cause: error,
          }),
        );
      }
    };
    cancelCleanup = schedule(run, 0);
  };

  const toRestoredDraft = (
    comment: PersistedInlineCommentDraft,
    updatedAt: number,
  ): InlineCommentDraft => ({
    ...comment,
    revision: generateRevision(),
    submissionId: null,
    updatedAt,
    status: "pending",
  });

  const readOwnerEntry = (ownerKey: string): OwnerPersistenceEntry | null =>
    ownerEntries.get(ownerKey) ?? null;

  const getOrCreateOwnerEntry = (ownerKey: string): OwnerPersistenceEntry => {
    const existing = ownerEntries.get(ownerKey);
    if (existing) {
      return existing;
    }

    const entry: OwnerPersistenceEntry = {
      version: 0,
      persistedVersion: 0,
      cancelMaxFlush: null,
      cancelTrailingFlush: null,
    };
    ownerEntries.set(ownerKey, entry);
    return entry;
  };

  const clearOwnerTimers = (entry: OwnerPersistenceEntry): void => {
    entry.cancelMaxFlush?.();
    entry.cancelMaxFlush = null;
    entry.cancelTrailingFlush?.();
    entry.cancelTrailingFlush = null;
  };

  const setPersistenceWarning = (
    ownerKey: string,
    warning: InlineCommentPersistenceWarning | null,
  ): void => {
    store.setState((state) => {
      const currentWarning = state.persistenceWarningsByOwner[ownerKey] ?? null;
      if (currentWarning === warning) {
        return state;
      }

      const persistenceWarningsByOwner = { ...state.persistenceWarningsByOwner };
      if (warning === null) {
        delete persistenceWarningsByOwner[ownerKey];
      } else {
        persistenceWarningsByOwner[ownerKey] = warning;
      }
      return { persistenceWarningsByOwner };
    });
  };

  const readOwnerDrafts = (ownerKey: string): InlineCommentDraft[] =>
    store.getState().draftsByOwner[ownerKey] ?? [];

  const persistOwner = (ownerKey: string): InlineCommentPersistenceWarning | null => {
    const result = writeInlineCommentDraftsToStorage({
      storage,
      ownerKey,
      comments: readOwnerDrafts(ownerKey).map(toPersistedDraft),
      updatedAt: new Date().toISOString(),
    });
    return result.status === "oversized" ? "oversized" : null;
  };

  /**
   * Writes the drafts of the owner now and sets its warning. Returns why it could not save them, or
   * `null`.
   */
  const flushOwner = (ownerKey: string): Error | null => {
    const entry = readOwnerEntry(ownerKey);
    if (!entry) {
      return null;
    }

    clearOwnerTimers(entry);
    const version = entry.version;
    try {
      const warning = persistOwner(ownerKey);
      setPersistenceWarning(ownerKey, warning);
      // Oversized drafts stay unsaved. Thus each `saveAll` reports them until the user
      // shortens them.
      if (warning === "oversized") return new Error("The inline comments are too large to save.");
      entry.persistedVersion = version;
      return null;
    } catch (error) {
      setPersistenceWarning(ownerKey, "storage_unavailable");
      reportPersistenceError(error);
      return error instanceof Error ? error : new Error(String(error));
    }
  };

  /** Flushes every owner that has unsaved changes. Returns why it could not save some owners. */
  const flushUnsavedOwners = (): Error[] => {
    const failures: Error[] = [];
    for (const [ownerKey, entry] of ownerEntries) {
      if (entry.version === entry.persistedVersion) continue;
      const failure = flushOwner(ownerKey);
      if (failure) failures.push(failure);
    }
    return failures;
  };

  const scheduleOwnerFlush = (ownerKey: string): void => {
    const entry = getOrCreateOwnerEntry(ownerKey);
    if (entry.cancelMaxFlush === null) {
      entry.cancelMaxFlush = schedule(() => {
        flushOwner(ownerKey);
      }, MAX_WAIT_MS);
    }

    entry.cancelTrailingFlush?.();
    entry.cancelTrailingFlush = schedule(() => {
      flushOwner(ownerKey);
    }, TRAILING_WAIT_MS);
  };

  const markOwnerChanged = (ownerKey: string): void => {
    const entry = getOrCreateOwnerEntry(ownerKey);
    entry.version += 1;
    scheduleOwnerFlush(ownerKey);
  };

  const markOwnerChangedNow = (ownerKey: string): void => {
    const entry = getOrCreateOwnerEntry(ownerKey);
    entry.version += 1;
    flushOwner(ownerKey);
  };

  const store = createStore<InlineCommentDraftStore>((set, get) => ({
    draftsByOwner: {},
    persistenceWarningsByOwner: {},
    hydratedOwners: {},

    addDraft: (ownerKey, draft) => {
      const text = draft.text.trim();
      if (text.length === 0) {
        throw new Error("Inline comments cannot be empty.");
      }

      const id = generateId();
      const { startLine, endLine } = orderLines(draft.startLine, draft.endLine);
      const newDraft: InlineCommentDraft = {
        id,
        filePath: draft.filePath,
        diffScope: draft.diffScope,
        startLine,
        endLine,
        side: draft.side,
        text,
        codeContext: draft.codeContext,
        language: draft.language ?? null,
        revision: generateRevision(),
        submissionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending",
      };
      set((state) => ({
        draftsByOwner: {
          ...state.draftsByOwner,
          [ownerKey]: [...(state.draftsByOwner[ownerKey] ?? []), newDraft],
        },
      }));
      markOwnerChanged(ownerKey);
      return id;
    },

    updateDraft: (ownerKey, id, text) => {
      const trimmedText = text.trim();
      if (trimmedText.length === 0) {
        throw new Error("Inline comments cannot be empty.");
      }
      const draft = readOwnerDrafts(ownerKey).find((candidate) => candidate.id === id);
      if (draft?.status === "submitting") {
        throw new Error("Cannot edit a git diff comment while it is being sent.");
      }

      set((state) => ({
        draftsByOwner: {
          ...state.draftsByOwner,
          [ownerKey]: (state.draftsByOwner[ownerKey] ?? []).map((currentDraft) =>
            currentDraft.id === id && currentDraft.status === "pending"
              ? {
                  ...currentDraft,
                  text: trimmedText,
                  revision: generateRevision(),
                  submissionId: null,
                  updatedAt: Date.now(),
                }
              : currentDraft,
          ),
        },
      }));
      markOwnerChanged(ownerKey);
    },

    removeDraft: (ownerKey, id) => {
      const draft = readOwnerDrafts(ownerKey).find((candidate) => candidate.id === id);
      if (draft?.status === "submitting") {
        throw new Error("Cannot remove a git diff comment while it is being sent.");
      }

      set((state) => ({
        draftsByOwner: {
          ...state.draftsByOwner,
          [ownerKey]: (state.draftsByOwner[ownerKey] ?? []).filter(
            (currentDraft) => currentDraft.id !== id,
          ),
        },
      }));
      markOwnerChanged(ownerKey);
    },

    getPendingDrafts: (ownerKey) =>
      readOwnerDrafts(ownerKey)
        .filter((draft) => draft.status === "pending")
        .sort(compareDrafts),

    beginSubmittingDrafts: (ownerKey, drafts) => {
      if (drafts.length === 0) {
        return null;
      }

      const submissionId = generateSubmissionId();
      let didTransition = false;
      set((state) => ({
        draftsByOwner: {
          ...state.draftsByOwner,
          [ownerKey]: (state.draftsByOwner[ownerKey] ?? []).map((draft) => {
            if (
              draft.status === "pending" &&
              drafts.some((snapshot) => matchesRevision(draft, snapshot))
            ) {
              didTransition = true;
              return {
                ...draft,
                status: "submitting",
                submissionId,
              };
            }
            return draft;
          }),
        },
      }));
      return didTransition ? submissionId : null;
    },

    restoreSubmittingDrafts: (submissionId) => {
      if (submissionId.length === 0) {
        return;
      }

      const missingDrafts = missingDraftsBySubmission.get(submissionId) ?? [];
      missingDraftsBySubmission.delete(submissionId);
      const changedOwnerKeys: string[] = [];
      set((state) => {
        let didChange = false;
        const draftsByOwner: Record<string, InlineCommentDraft[]> = {};
        for (const [ownerKey, drafts] of Object.entries(state.draftsByOwner)) {
          const nextDrafts: InlineCommentDraft[] = [];
          for (const draft of drafts) {
            if (draft.status !== "submitting" || draft.submissionId !== submissionId) {
              nextDrafts.push(draft);
              continue;
            }
            didChange = true;
            if (
              !missingDrafts.some(
                (snapshot) => snapshot.ownerKey === ownerKey && matchesRevision(draft, snapshot),
              )
            ) {
              nextDrafts.push({ ...draft, status: "pending", submissionId: null });
            }
          }
          if (nextDrafts.length !== drafts.length) changedOwnerKeys.push(ownerKey);
          draftsByOwner[ownerKey] = nextDrafts;
        }
        return didChange ? { draftsByOwner } : state;
      });
      for (const ownerKey of changedOwnerKeys) markOwnerChangedNow(ownerKey);
    },

    completeSubmittingDrafts: (submissionId) => {
      if (submissionId.length === 0) {
        return;
      }

      missingDraftsBySubmission.delete(submissionId);
      const state = get();
      const changedOwnerKeys: string[] = [];
      const draftsByOwner: Record<string, InlineCommentDraft[]> = {};
      let didChange = false;
      for (const [ownerKey, drafts] of Object.entries(state.draftsByOwner)) {
        const nextDrafts = drafts.filter(
          (draft) => !(draft.status === "submitting" && draft.submissionId === submissionId),
        );
        didChange = didChange || nextDrafts.length !== drafts.length;
        if (nextDrafts.length !== drafts.length) {
          changedOwnerKeys.push(ownerKey);
        }
        draftsByOwner[ownerKey] = nextDrafts;
      }
      if (!didChange) {
        return;
      }

      set({ draftsByOwner });
      for (const ownerKey of changedOwnerKeys) {
        markOwnerChangedNow(ownerKey);
      }
    },

    dropDraftsForMissingFiles: (ownerKey, diffScope, presentFilePaths) => {
      const validationKey = `${ownerKey}\u0000${diffScope}`;
      if (validatedOwnerScopes.has(validationKey)) {
        return;
      }
      validatedOwnerScopes.add(validationKey);

      const drafts = readOwnerDrafts(ownerKey);
      if (drafts.length === 0) {
        return;
      }

      const nextDrafts = drafts.filter((draft) => {
        if (draft.diffScope !== diffScope || presentFilePaths.has(draft.filePath)) return true;
        if (draft.status !== "submitting") return false;
        // Keep the batch locked until Send settles, then drop only these missing revisions.
        if (draft.submissionId !== null) {
          const missingDrafts = missingDraftsBySubmission.get(draft.submissionId) ?? [];
          missingDrafts.push({ ownerKey, id: draft.id, revision: draft.revision });
          missingDraftsBySubmission.set(draft.submissionId, missingDrafts);
        }
        return true;
      });
      if (nextDrafts.length === drafts.length) {
        return;
      }

      set((state) => ({
        draftsByOwner: { ...state.draftsByOwner, [ownerKey]: nextDrafts },
      }));
      markOwnerChangedNow(ownerKey);
    },

    getDraftCount: (ownerKey) => get().getPendingDrafts(ownerKey).length,

    getFileDraftCount: (ownerKey, filePath, diffScope) =>
      readOwnerDrafts(ownerKey).filter(
        (draft) =>
          draft.filePath === filePath && (diffScope == null || draft.diffScope === diffScope),
      ).length,

    getDraftsForFile: (ownerKey, filePath, diffScope) =>
      readOwnerDrafts(ownerKey)
        .filter(
          (draft) =>
            draft.filePath === filePath && (diffScope == null || draft.diffScope === diffScope),
        )
        .sort(compareDrafts),

    getPersistenceWarning: (ownerKey) => get().persistenceWarningsByOwner[ownerKey] ?? null,

    formatBatchMessage: (drafts) => {
      if (drafts.length === 0) {
        return "";
      }

      const sections = drafts.map((draft, index) => {
        const { startLine, endLine } = orderLines(draft.startLine, draft.endLine);
        return [
          `### Comment ${index + 1}`,
          `File: \`${draft.filePath}\``,
          `Diff: ${DIFF_SCOPE_LABELS[draft.diffScope]}`,
          `Change: ${mapCommentSideToChange(draft.side)}`,
          `Lines: ${formatLineRange(startLine, endLine)}`,
          formatSelectedContextBlock(draft.codeContext, draft.language),
          `Instruction: ${draft.text}`,
        ].join("\n");
      });

      return ["## Git Diff Comments", ...sections].join("\n\n");
    },

    formatPendingBatchMessage: (ownerKey) => {
      return get().formatBatchMessage(get().getPendingDrafts(ownerKey));
    },

    hydrate: (ownerKey) => {
      if (get().hydratedOwners[ownerKey]) return;
      try {
        const result = readInlineCommentDraftsFromStorage({
          storage,
          ownerKey,
          now: new Date(),
        });
        if (result.status === "restored" && !get().draftsByOwner[ownerKey]) {
          const updatedAt = Date.parse(result.updatedAt);
          set((state) => ({
            draftsByOwner: {
              ...state.draftsByOwner,
              [ownerKey]: result.comments.map((comment) => toRestoredDraft(comment, updatedAt)),
            },
          }));
          getOrCreateOwnerEntry(ownerKey);
        }
        startCleanup();
      } catch (error) {
        setPersistenceWarning(ownerKey, "storage_unavailable");
        reportPersistenceError(error);
      }
      set((state) => ({ hydratedOwners: { ...state.hydratedOwners, [ownerKey]: true } }));
    },

    flush: () => {
      flushUnsavedOwners();
    },
  }));

  return Object.assign(store, {
    saveAll: () => {
      const [failure] = flushUnsavedOwners();
      if (failure) {
        throw new Error(`Could not save inline comments. ${failure.message}`, { cause: failure });
      }
    },
    dispose: () => {
      cancelCleanup?.();
      cancelCleanup = null;
      for (const entry of ownerEntries.values()) {
        clearOwnerTimers(entry);
      }
      missingDraftsBySubmission.clear();
    },
  });
};

export const toInlineCommentDraftOwnerKey = (owner: InlineCommentOwner | null): string | null => {
  if (!owner || !owner.workspaceId.trim()) return null;
  const id = owner.kind === "task" ? owner.taskId : owner.sessionId;
  if (!id.trim()) return null;
  return toInlineCommentDraftStorageKey(
    owner.kind === "task"
      ? { workspaceId: owner.workspaceId, taskId: id }
      : { workspaceId: owner.workspaceId, workspaceSessionId: id },
  );
};
