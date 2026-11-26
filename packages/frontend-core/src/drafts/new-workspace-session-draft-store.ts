import {
  agentSessionModelSelectionSchema,
  type AgentSessionModelSelection,
  type GitTargetBranch,
  gitTargetBranchSchema,
  type WorkspaceSessionLocation,
  workspaceSessionLocationSchema,
  type WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";
import { z } from "zod";
import type { ClientStorage } from "../platform/client-storage";
import type { AgentChatDraftPersistence } from "../sessions/send/agent-chat-draft-scope";
import type { StartupAttemptStore } from "../sessions/startup/startup-attempt-store";
import { findDraftStartupAttempt, startupIsPending } from "../sessions/startup/startup-navigation";
import {
  INITIAL_WORKSPACE_SESSION_WORKTREE,
  resolveTargetBranchOnLocationChange,
} from "../workspace-sessions/create/workspace-session-worktree-rules";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
  draftHasMeaningfulContent,
  draftToSerializedText,
  normalizeComposerDraft,
} from "./agent-chat-composer-draft";
import { AGENT_CHAT_DRAFT_STORAGE_TTL_MS } from "./agent-chat-draft-storage";
import type { AgentChatDraftStore } from "./agent-chat-draft-store";

const DRAFT_KEY_PREFIX = "openducktor:new-workspace-session:draft:v1:";
export const NEW_WORKSPACE_SESSION_LAST_LOCATION_STORAGE_KEY =
  "openducktor:new-workspace-session:last-location:v1";

export type WorkspaceSessionDraftLifecycle = "untouched" | "retained";

export type WorkspaceSessionDraftOptions = {
  location: WorkspaceSessionLocation;
  worktree: WorkspaceSessionWorktreeInput;
  existingWorktreeDirectory: string | null;
  targetBranch: GitTargetBranch | null;
  customAgentRoleId: string | null;
  selectedModel: AgentSessionModelSelection | null;
};

export type WorkspaceSessionDraft = {
  id: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  lifecycle: WorkspaceSessionDraftLifecycle;
  composer: AgentChatComposerDraft;
  options: WorkspaceSessionDraftOptions;
};

export const DEFAULT_WORKSPACE_SESSION_DRAFT_OPTIONS: WorkspaceSessionDraftOptions = {
  location: "local_repo_root",
  worktree: INITIAL_WORKSPACE_SESSION_WORKTREE,
  existingWorktreeDirectory: null,
  targetBranch: null,
  customAgentRoleId: null,
  selectedModel: null,
};

const persistedDraftSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  options: z.strictObject({
    location: workspaceSessionLocationSchema,
    worktree: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("from_branch"),
        name: z.string(),
        branchName: z.string(),
      }),
      z.strictObject({
        mode: z.literal("from_name"),
        name: z.string(),
        branchName: z.string().nullable(),
      }),
    ]),
    existingWorktreeDirectory: z.string().min(1).nullable(),
    targetBranch: gitTargetBranchSchema.nullable(),
    customAgentRoleId: z.string().min(1).nullable(),
    selectedModel: agentSessionModelSelectionSchema.nullable(),
  }),
});

export const toNewWorkspaceSessionDraftStorageKey = (
  workspaceId: string,
  draftId: string,
): string => `${DRAFT_KEY_PREFIX}${encodeURIComponent(workspaceId)}:${encodeURIComponent(draftId)}`;

const chatIdentityFor = (workspaceId: string, draftId: string) => ({
  workspaceId,
  newSessionDraftId: draftId,
});

const isDraftUntouched = (
  composer: AgentChatComposerDraft,
  options: WorkspaceSessionDraftOptions,
  defaultLocation: WorkspaceSessionLocation = "local_repo_root",
): boolean =>
  !draftHasMeaningfulContent(composer) &&
  options.location === defaultLocation &&
  options.worktree.mode === "from_name" &&
  options.worktree.name === "" &&
  options.worktree.branchName === null &&
  options.existingWorktreeDirectory === null &&
  options.targetBranch === null &&
  options.customAgentRoleId === null &&
  options.selectedModel === null;

/** Derives a display title from the first trimmed non-empty line of text, or "New session". */
export const workspaceSessionDraftTitle = (
  draft: Pick<WorkspaceSessionDraft, "composer">,
  submittedComposer?: AgentChatComposerDraft | null,
): string => {
  const serialized = draftToSerializedText(submittedComposer ?? draft.composer);
  for (const line of serialized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "New session";
};

const stripWorkspaceScopedReferences = (composer: AgentChatComposerDraft) => {
  let removedReferenceCount = 0;
  const segments = composer.segments.filter((segment) => {
    if (
      segment.kind === "file_reference" ||
      segment.kind === "skill_mention" ||
      segment.kind === "subagent_reference"
    ) {
      removedReferenceCount += 1;
      return false;
    }
    return true;
  });
  return {
    composer: normalizeComposerDraft({ segments, attachments: composer.attachments ?? [] }),
    removedReferenceCount,
  };
};

type DraftRecord = {
  draft: WorkspaceSessionDraft;
  initialLocation: WorkspaceSessionLocation;
  persistedStorageKey: string | null;
};

export type NewWorkspaceSessionDraftStoreOptions = {
  storage: ClientStorage;
  chatDrafts: AgentChatDraftStore;
  startupAttempts?: StartupAttemptStore;
  reportPersistenceError?: (error: Error) => void;
  now?: () => Date;
};

export type NewWorkspaceSessionDraftStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly WorkspaceSessionDraft[];
  getDraft(draftId: string): WorkspaceSessionDraft | null;
  isStarting(draftId: string): boolean;
  createDraft(workspaceId: string): WorkspaceSessionDraft;
  ensureDraftForNewSession(
    workspaceId: string,
    activeDraftId: string | null,
  ): WorkspaceSessionDraft;
  updateComposer(draftId: string, composer: AgentChatComposerDraft): number;
  updateOptions(
    draftId: string,
    patch: Partial<WorkspaceSessionDraftOptions>,
  ): WorkspaceSessionDraft | null;
  switchWorkspace(draftId: string, nextWorkspaceId: string): { removedReferenceCount: number };
  composerPersistence(draftId: string): AgentChatDraftPersistence;
  attachDraftView(draftId: string): () => void;
  discard(draftId: string): boolean;
  pruneRemovedWorkspaces(knownWorkspaceIds: ReadonlySet<string>): void;
  dispose(): void;
};

export const createNewWorkspaceSessionDraftStore = ({
  storage,
  chatDrafts,
  startupAttempts,
  reportPersistenceError = (error) => console.error(error),
  now = () => new Date(),
}: NewWorkspaceSessionDraftStoreOptions): NewWorkspaceSessionDraftStore => {
  const records = new Map<string, DraftRecord>();
  const listeners = new Set<() => void>();
  const activeViewCounts = new Map<string, number>();
  const composerExternalListeners = new Map<string, Set<() => void>>();
  let snapshot: readonly WorkspaceSessionDraft[] = [];
  let hydrated = false;

  const reportError = (cause: unknown): void => {
    reportPersistenceError(cause instanceof Error ? cause : new Error(String(cause)));
  };

  const removeKey = (key: string): void => {
    try {
      storage.removeItem(key);
    } catch (cause) {
      reportError(new Error(`Failed to remove new session draft storage key "${key}".`, { cause }));
    }
  };

  const publish = (): void => {
    snapshot = [...records.values()].map((entry) => entry.draft);
    for (const listener of listeners) listener();
  };

  const isStarting = (draftId: string): boolean => {
    if (!startupAttempts) return false;
    const attempt = findDraftStartupAttempt(startupAttempts.getSnapshot(), draftId);
    return attempt !== null && startupIsPending(attempt);
  };

  const persistMetadata = (record: DraftRecord): void => {
    const { draft } = record;
    if (isDraftUntouched(draft.composer, draft.options, record.initialLocation)) {
      if (record.persistedStorageKey) {
        removeKey(record.persistedStorageKey);
        record.persistedStorageKey = null;
      }
      return;
    }
    const key = toNewWorkspaceSessionDraftStorageKey(draft.workspaceId, draft.id);
    const payload: z.input<typeof persistedDraftSchema> = {
      version: 1,
      id: draft.id,
      workspaceId: draft.workspaceId,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      options: draft.options,
    };
    try {
      storage.setItem(key, JSON.stringify(payload));
      if (record.persistedStorageKey && record.persistedStorageKey !== key) {
        removeKey(record.persistedStorageKey);
      }
      record.persistedStorageKey = key;
    } catch (cause) {
      reportError(new Error(`Failed to persist new session draft "${key}".`, { cause }));
    }
  };

  const readLastLocation = (): WorkspaceSessionLocation => {
    try {
      const parsed = workspaceSessionLocationSchema.safeParse(
        storage.getItem(NEW_WORKSPACE_SESSION_LAST_LOCATION_STORAGE_KEY),
      );
      return parsed.success ? parsed.data : "local_repo_root";
    } catch (cause) {
      reportError(new Error("Failed to read last workspace session work location.", { cause }));
      return "local_repo_root";
    }
  };

  const ensureHydrated = (): void => {
    if (hydrated) return;
    hydrated = true;
    const keys: string[] = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
      }
    } catch (cause) {
      reportError(new Error("Failed to read stored new session drafts.", { cause }));
      return;
    }
    const nowMs = now().getTime();
    for (const key of keys) {
      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch (cause) {
        reportError(new Error(`Failed to read new session draft storage key "${key}".`, { cause }));
        continue;
      }
      if (!raw) continue;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        removeKey(key);
        continue;
      }
      const parsed = persistedDraftSchema.safeParse(json);
      if (!parsed.success) {
        removeKey(key);
        continue;
      }
      const data = parsed.data;
      const ageMs = nowMs - data.updatedAt;
      if (
        toNewWorkspaceSessionDraftStorageKey(data.workspaceId, data.id) !== key ||
        ageMs < 0 ||
        ageMs >= AGENT_CHAT_DRAFT_STORAGE_TTL_MS
      ) {
        removeKey(key);
        continue;
      }
      const composer = chatDrafts.hydrate(chatIdentityFor(data.workspaceId, data.id), null);
      if (isDraftUntouched(composer, data.options)) {
        removeKey(key);
        continue;
      }
      if (records.has(data.id)) continue;
      records.set(data.id, {
        initialLocation: "local_repo_root",
        persistedStorageKey: key,
        draft: {
          id: data.id,
          workspaceId: data.workspaceId,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          lifecycle: "retained",
          composer,
          options: data.options,
        },
      });
    }
    if (records.size > 0) {
      snapshot = [...records.values()].map((entry) => entry.draft);
    }
  };

  const removeRecordEntry = (draftId: string, record: DraftRecord): void => {
    records.delete(draftId);
    activeViewCounts.delete(draftId);
    composerExternalListeners.delete(draftId);
    chatDrafts.clear(chatIdentityFor(record.draft.workspaceId, draftId));
    if (record.persistedStorageKey) {
      removeKey(record.persistedStorageKey);
    }
  };

  const deleteRecord = (draftId: string): void => {
    const record = records.get(draftId);
    if (!record) return;
    removeRecordEntry(draftId, record);
    publish();
  };

  const retireSavedDrafts = (): void => {
    if (!startupAttempts || records.size === 0) return;
    let changed = false;
    for (const attempt of startupAttempts.getSnapshot()) {
      if (
        attempt.ownership.state === "saved" &&
        attempt.origin.scope.kind === "workspace" &&
        attempt.origin.scope.draftId
      ) {
        const record = records.get(attempt.origin.scope.draftId);
        if (record) {
          removeRecordEntry(attempt.origin.scope.draftId, record);
          changed = true;
        }
      }
    }
    if (changed) publish();
  };

  const unsubscribeStartupAttempts = startupAttempts?.subscribe(retireSavedDrafts) ?? null;

  const createDraft = (workspaceId: string): WorkspaceSessionDraft => {
    ensureHydrated();
    const timestamp = now().getTime();
    const initialLocation = readLastLocation();
    const draft: WorkspaceSessionDraft = {
      id: crypto.randomUUID(),
      workspaceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lifecycle: "untouched",
      composer: createEmptyComposerDraft(),
      options: { ...DEFAULT_WORKSPACE_SESSION_DRAFT_OPTIONS, location: initialLocation },
    };
    records.set(draft.id, { draft, initialLocation, persistedStorageKey: null });
    publish();
    return draft;
  };

  const updateComposer = (draftId: string, composer: AgentChatComposerDraft): number => {
    ensureHydrated();
    const record = records.get(draftId);
    if (!record || isStarting(draftId)) return 0;
    const identity = chatIdentityFor(record.draft.workspaceId, draftId);
    const version = chatDrafts.set(identity, null, composer);
    const storedComposer = chatDrafts.hydrate(identity, null);
    const untouched = isDraftUntouched(
      storedComposer,
      record.draft.options,
      record.initialLocation,
    );
    record.draft = {
      ...record.draft,
      composer: storedComposer,
      lifecycle: untouched ? "untouched" : "retained",
      updatedAt: now().getTime(),
    };
    persistMetadata(record);
    publish();
    return version;
  };

  const flush = (draftId: string): Promise<void> => {
    ensureHydrated();
    const record = records.get(draftId);
    if (!record) return Promise.resolve();
    persistMetadata(record);
    return chatDrafts.flush(chatIdentityFor(record.draft.workspaceId, draftId));
  };

  const leaveDraft = (draftId: string): void => {
    ensureHydrated();
    const record = records.get(draftId);
    if (!record) return;
    if (record.draft.lifecycle === "untouched" && !isStarting(draftId)) {
      deleteRecord(draftId);
    } else {
      void flush(draftId);
    }
  };

  return {
    subscribe(listener) {
      ensureHydrated();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      ensureHydrated();
      return snapshot;
    },
    getDraft(draftId) {
      ensureHydrated();
      return records.get(draftId)?.draft ?? null;
    },
    isStarting,
    createDraft,
    ensureDraftForNewSession(workspaceId, activeDraftId) {
      ensureHydrated();
      if (activeDraftId) {
        const active = records.get(activeDraftId)?.draft;
        if (
          active &&
          active.workspaceId === workspaceId &&
          active.lifecycle === "untouched" &&
          !isStarting(active.id)
        ) {
          return active;
        }
      }
      return createDraft(workspaceId);
    },
    updateComposer,
    updateOptions(draftId, patch) {
      ensureHydrated();
      const record = records.get(draftId);
      if (!record || isStarting(draftId)) return null;
      const rawNext: WorkspaceSessionDraftOptions = { ...record.draft.options, ...patch };
      const nextOptions: WorkspaceSessionDraftOptions = {
        ...rawNext,
        targetBranch:
          rawNext.location !== record.draft.options.location
            ? resolveTargetBranchOnLocationChange(rawNext.location, rawNext.targetBranch)
            : rawNext.targetBranch,
      };
      if (patch.location !== undefined) {
        try {
          storage.setItem(NEW_WORKSPACE_SESSION_LAST_LOCATION_STORAGE_KEY, nextOptions.location);
        } catch (cause) {
          reportError(new Error("Failed to save last workspace session work location.", { cause }));
        }
      }
      const untouched = isDraftUntouched(
        record.draft.composer,
        nextOptions,
        record.initialLocation,
      );
      record.draft = {
        ...record.draft,
        options: nextOptions,
        lifecycle: untouched ? "untouched" : "retained",
        updatedAt: now().getTime(),
      };
      persistMetadata(record);
      publish();
      return record.draft;
    },
    switchWorkspace(draftId, nextWorkspaceId) {
      ensureHydrated();
      const record = records.get(draftId);
      if (!record || isStarting(draftId) || record.draft.workspaceId === nextWorkspaceId) {
        return { removedReferenceCount: 0 };
      }
      const { composer: nextComposer, removedReferenceCount } = stripWorkspaceScopedReferences(
        record.draft.composer,
      );
      const nextOptions: WorkspaceSessionDraftOptions = {
        ...DEFAULT_WORKSPACE_SESSION_DRAFT_OPTIONS,
        location: record.draft.options.location,
        customAgentRoleId: record.draft.options.customAgentRoleId,
      };
      chatDrafts.clear(chatIdentityFor(record.draft.workspaceId, draftId));
      if (draftHasMeaningfulContent(nextComposer)) {
        chatDrafts.set(chatIdentityFor(nextWorkspaceId, draftId), null, nextComposer);
      }
      const untouched = isDraftUntouched(nextComposer, nextOptions, record.initialLocation);
      record.draft = {
        ...record.draft,
        workspaceId: nextWorkspaceId,
        composer: nextComposer,
        options: nextOptions,
        lifecycle: untouched ? "untouched" : "retained",
        updatedAt: now().getTime(),
      };
      persistMetadata(record);
      publish();
      if (removedReferenceCount > 0) {
        const draftListeners = composerExternalListeners.get(draftId);
        if (draftListeners) {
          for (const listener of draftListeners) listener();
        }
      }
      return { removedReferenceCount };
    },
    /**
     * Bridges a draft to `useAgentChatComposerDraftState`.
     * `clear()` is a no-op during submission so the draft stays intact until host save confirmation.
     */
    composerPersistence(draftId): AgentChatDraftPersistence {
      return {
        targetKey: `new-workspace-session:${draftId}`,
        hydrate: () => {
          ensureHydrated();
          return records.get(draftId)?.draft.composer ?? createEmptyComposerDraft();
        },
        set: (draft) => updateComposer(draftId, draft),
        readVersion: () => {
          ensureHydrated();
          const record = records.get(draftId);
          return record
            ? chatDrafts.readVersion(chatIdentityFor(record.draft.workspaceId, draftId))
            : null;
        },
        clear: () => false,
        subscribeExternalChange: (listener) => {
          let draftListeners = composerExternalListeners.get(draftId);
          if (!draftListeners) {
            draftListeners = new Set();
            composerExternalListeners.set(draftId, draftListeners);
          }
          draftListeners.add(listener);
          return () => {
            draftListeners?.delete(listener);
            if (draftListeners?.size === 0) composerExternalListeners.delete(draftId);
          };
        },
        flush: () => flush(draftId),
      };
    },
    /**
     * Acquires a view lease for `draftId`. When the last view releases after a microtask grace
     * window (tolerating StrictMode remounts), untouched drafts discard and retained drafts flush.
     * Intentional discards, save retirements, and workspace switches suppress leave automatically.
     */
    attachDraftView(draftId) {
      ensureHydrated();
      const attachedWorkspaceId = records.get(draftId)?.draft.workspaceId ?? null;
      activeViewCounts.set(draftId, (activeViewCounts.get(draftId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const nextCount = (activeViewCounts.get(draftId) ?? 0) - 1;
        if (nextCount <= 0) activeViewCounts.delete(draftId);
        else activeViewCounts.set(draftId, nextCount);
        queueMicrotask(() => {
          if ((activeViewCounts.get(draftId) ?? 0) > 0) return;
          const record = records.get(draftId);
          if (!record) return;
          if (attachedWorkspaceId !== null && record.draft.workspaceId !== attachedWorkspaceId) {
            return;
          }
          leaveDraft(draftId);
        });
      };
    },
    discard(draftId) {
      ensureHydrated();
      const record = records.get(draftId);
      if (!record || isStarting(draftId)) return false;
      deleteRecord(draftId);
      if (startupAttempts) {
        for (const attempt of startupAttempts.getSnapshot()) {
          if (
            attempt.ownership.state !== "saved" &&
            attempt.origin.scope.kind === "workspace" &&
            attempt.origin.scope.draftId === draftId
          ) {
            startupAttempts.release(attempt.id);
          }
        }
      }
      return true;
    },
    pruneRemovedWorkspaces(knownWorkspaceIds) {
      ensureHydrated();
      let changed = false;
      for (const [draftId, record] of records.entries()) {
        if (knownWorkspaceIds.has(record.draft.workspaceId)) continue;
        if (isStarting(draftId)) continue;
        removeRecordEntry(draftId, record);
        changed = true;
      }
      if (changed) publish();
    },
    dispose() {
      unsubscribeStartupAttempts?.();
      activeViewCounts.clear();
      composerExternalListeners.clear();
      listeners.clear();
    },
  };
};
