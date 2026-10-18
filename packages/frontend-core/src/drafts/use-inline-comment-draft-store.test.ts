import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  toInlineCommentDraftStorageKey,
  readInlineCommentDraftsFromStorage,
  type PersistedInlineCommentDraft,
} from "./inline-comment-draft-storage";
import type { ScheduleTask } from "../lib/scheduling";
import type { ClientStorage } from "../platform/client-storage";
import {
  type AddInlineCommentDraftInput,
  createInlineCommentDraftStore,
  type InlineCommentDraftStoreApi,
} from "./inline-comment-draft-store";

type TestStorage = ClientStorage;

const createMemoryStorage = (): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

const createThrowingStorage = (): TestStorage => ({
  get length(): number {
    throw new Error("Storage is unavailable.");
  },
  key: () => null,
  getItem: () => {
    throw new Error("Storage is unavailable.");
  },
  setItem: () => {
    throw new Error("Storage is unavailable.");
  },
  removeItem: () => {
    throw new Error("Storage is unavailable.");
  },
});

const createSwitchableStorage = (initial: TestStorage) => {
  let target = initial;
  return {
    get length() {
      return target.length;
    },
    key: (index: number) => target.key(index),
    getItem: (key: string) => target.getItem(key),
    setItem: (key: string, value: string) => target.setItem(key, value),
    removeItem: (key: string) => target.removeItem(key),
    use: (next: TestStorage) => {
      target = next;
    },
  };
};

const OWNER = toInlineCommentDraftStorageKey({ workspaceId: "workspace-1", taskId: "task-1" });
const OTHER_OWNER = toInlineCommentDraftStorageKey({
  workspaceId: "workspace-1",
  taskId: "task-2",
});

const buildInput = (
  overrides: Partial<AddInlineCommentDraftInput> = {},
): AddInlineCommentDraftInput => ({
  filePath: "packages/frontend/src/file-a.ts",
  diffScope: "uncommitted",
  startLine: 10,
  endLine: 10,
  side: "new",
  text: "Initial note",
  codeContext: [{ lineNumber: 10, text: "const a = 1;", isSelected: true }],
  language: "ts",
  ...overrides,
});

const buildStoredComment = (
  overrides: Partial<PersistedInlineCommentDraft> = {},
): PersistedInlineCommentDraft => ({
  id: "stored-comment",
  filePath: "packages/frontend/src/file-a.ts",
  diffScope: "uncommitted",
  side: "new",
  startLine: 4,
  endLine: 6,
  text: "Stored instruction",
  codeContext: [{ lineNumber: 5, text: "stored line", isSelected: true }],
  language: "ts",
  createdAt: 1_700_000_000_000,
  ...overrides,
});

const writeStoredPayload = (
  storage: TestStorage,
  ownerKey: string,
  comments: PersistedInlineCommentDraft[],
  updatedAt = new Date().toISOString(),
): void => {
  storage.setItem(
    ownerKey,
    JSON.stringify({
      version: 1,
      workspaceId: "workspace-1",
      taskId: ownerKey === OWNER ? "task-1" : "task-2",
      updatedAt,
      comments,
    }),
  );
};

const originalDateNow = Date.now;
let persistenceErrors: Error[] = [];
const createdStores: InlineCommentDraftStoreApi[] = [];
let drafts: InlineCommentDraftStoreApi;

const createDrafts = ({
  storage,
  scheduleTask = () => () => {},
}: {
  storage: TestStorage;
  scheduleTask?: ScheduleTask;
}): InlineCommentDraftStoreApi => {
  drafts = createInlineCommentDraftStore({
    storage,
    scheduleTask,
    reportPersistenceError: (error) => {
      persistenceErrors.push(error);
    },
  });
  createdStores.push(drafts);
  return drafts;
};

const requireDraftRevision = (ownerKey: string, index: number): number => {
  const revision = drafts.getState().draftsByOwner[ownerKey]?.[index]?.revision;
  if (revision == null) {
    throw new Error(`Expected draft revision at index ${index}`);
  }
  return revision;
};

describe("use-inline-comment-draft-store", () => {
  beforeEach(() => {
    persistenceErrors = [];
    createDrafts({ storage: createMemoryStorage() });
  });

  afterEach(() => {
    Date.now = originalDateNow;
    for (const store of createdStores.splice(0)) {
      store.dispose();
    }
  });

  test("drops submitted comments from the owner after a successful send", () => {
    Date.now = () => 1_700_000_000_000;

    const firstId = drafts.getState().addDraft(OWNER, buildInput());
    const secondId = drafts.getState().addDraft(
      OWNER,
      buildInput({
        diffScope: "target",
        startLine: 20,
        endLine: 22,
        side: "old",
        text: "Second note",
        codeContext: [{ lineNumber: 20, text: "old line", isSelected: true }],
      }),
    );

    const addedState = drafts.getState();
    expect(addedState.getDraftCount(OWNER)).toBe(2);
    expect(addedState.getFileDraftCount(OWNER, "packages/frontend/src/file-a.ts")).toBe(2);
    expect(
      addedState.getFileDraftCount(OWNER, "packages/frontend/src/file-a.ts", "uncommitted"),
    ).toBe(1);
    expect(addedState.getFileDraftCount(OWNER, "packages/frontend/src/file-a.ts", "target")).toBe(
      1,
    );
    expect(
      addedState
        .getDraftsForFile(OWNER, "packages/frontend/src/file-a.ts")
        .map((draft) => draft.id),
    ).toEqual([secondId, firstId]);
    expect(
      addedState
        .getDraftsForFile(OWNER, "packages/frontend/src/file-a.ts", "uncommitted")
        .map((draft) => draft.id),
    ).toEqual([firstId]);

    addedState.updateDraft(OWNER, firstId, "Updated note");
    expect(
      drafts.getState().draftsByOwner[OWNER]?.find((draft) => draft.id === firstId)?.text,
    ).toBe("Updated note");
    const pendingSnapshots = drafts
      .getState()
      .getPendingDrafts(OWNER)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    Date.now = () => 1_700_000_000_100;
    const submissionId = drafts.getState().beginSubmittingDrafts(OWNER, pendingSnapshots);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }
    drafts.getState().completeSubmittingDrafts(submissionId);

    const submittedState = drafts.getState();
    expect(submittedState.getDraftCount(OWNER)).toBe(0);
    expect(submittedState.getFileDraftCount(OWNER, "packages/frontend/src/file-a.ts")).toBe(0);
    expect(submittedState.draftsByOwner[OWNER]).toEqual([]);
  });

  test("removes only the submitted snapshot when another pending draft changes in flight", () => {
    Date.now = () => 1_700_000_000_000;

    const firstId = drafts.getState().addDraft(OWNER, buildInput());
    drafts.getState().addDraft(
      OWNER,
      buildInput({
        filePath: "packages/frontend/src/file-b.ts",
        diffScope: "target",
        startLine: 20,
        endLine: 20,
        side: "old",
        text: "Second note",
        codeContext: [{ lineNumber: 20, text: "second", isSelected: true }],
      }),
    );

    const sentSnapshot = drafts
      .getState()
      .getPendingDrafts(OWNER)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    Date.now = () => 1_700_000_000_050;
    drafts.getState().updateDraft(OWNER, firstId, "First note updated after send start");

    Date.now = () => 1_700_000_000_100;
    const submissionId = drafts.getState().beginSubmittingDrafts(OWNER, sentSnapshot);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }
    drafts.getState().completeSubmittingDrafts(submissionId);

    const ownerDrafts = drafts.getState().draftsByOwner[OWNER] ?? [];
    expect(ownerDrafts.find((draft) => draft.id === firstId)?.status).toBe("pending");
    expect(ownerDrafts.some((draft) => draft.filePath === "packages/frontend/src/file-b.ts")).toBe(
      false,
    );
  });

  test("rejects editing or removing a comment while that exact draft is being sent", () => {
    const draftId = drafts.getState().addDraft(OWNER, buildInput());
    const snapshot = drafts
      .getState()
      .getPendingDrafts(OWNER)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    const submissionId = drafts.getState().beginSubmittingDrafts(OWNER, snapshot);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }

    expect(() => drafts.getState().updateDraft(OWNER, draftId, "Edited")).toThrow(
      "Cannot edit a git diff comment while it is being sent.",
    );
    expect(() => drafts.getState().removeDraft(OWNER, draftId)).toThrow(
      "Cannot remove a git diff comment while it is being sent.",
    );
  });

  test("excludes submitting drafts from new pending batches and clears submitting locks per batch", () => {
    const firstId = drafts.getState().addDraft(OWNER, buildInput());
    const secondId = drafts.getState().addDraft(
      OWNER,
      buildInput({
        filePath: "packages/frontend/src/file-b.ts",
        diffScope: "target",
        startLine: 2,
        endLine: 2,
        side: "old",
        text: "Second",
        codeContext: [{ lineNumber: 2, text: "second", isSelected: true }],
      }),
    );

    const firstSnapshot = [{ id: firstId, revision: requireDraftRevision(OWNER, 0) }];
    const secondSnapshot = [{ id: secondId, revision: requireDraftRevision(OWNER, 1) }];

    const firstSubmissionId = drafts.getState().beginSubmittingDrafts(OWNER, firstSnapshot);
    if (firstSubmissionId == null) {
      throw new Error("Expected first submission id");
    }
    expect(
      drafts
        .getState()
        .getPendingDrafts(OWNER)
        .map((draft) => draft.id),
    ).toEqual([secondId]);
    expect(drafts.getState().getDraftCount(OWNER)).toBe(1);

    const secondSubmissionId = drafts.getState().beginSubmittingDrafts(OWNER, secondSnapshot);
    if (secondSubmissionId == null) {
      throw new Error("Expected second submission id");
    }
    expect(
      (drafts.getState().draftsByOwner[OWNER] ?? []).filter(
        (draft) => draft.status === "submitting",
      ),
    ).toHaveLength(2);
    expect(drafts.getState().getPendingDrafts(OWNER)).toEqual([]);

    drafts.getState().restoreSubmittingDrafts(firstSubmissionId);
    expect(
      drafts
        .getState()
        .getPendingDrafts(OWNER)
        .map((draft) => draft.id),
    ).toEqual([firstId]);
    expect(
      (drafts.getState().draftsByOwner[OWNER] ?? []).reduce<string[]>((draftIds, draft) => {
        if (draft.status === "submitting") {
          draftIds.push(draft.id);
        }
        return draftIds;
      }, []),
    ).toEqual([secondId]);
  });

  test("keeps owners isolated and completes a send by submission id across owners", () => {
    const firstId = drafts.getState().addDraft(OWNER, buildInput());
    const otherId = drafts.getState().addDraft(
      OTHER_OWNER,
      buildInput({
        filePath: "packages/frontend/src/other.ts",
        text: "Other task note",
      }),
    );

    const firstSnapshot = [{ id: firstId, revision: requireDraftRevision(OWNER, 0) }];
    const submissionId = drafts.getState().beginSubmittingDrafts(OWNER, firstSnapshot);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }

    expect(drafts.getState().getDraftCount(OWNER)).toBe(0);
    expect(drafts.getState().getDraftCount(OTHER_OWNER)).toBe(1);

    drafts.getState().completeSubmittingDrafts(submissionId);

    expect(drafts.getState().draftsByOwner[OWNER]).toEqual([]);
    expect(drafts.getState().draftsByOwner[OTHER_OWNER]?.map((draft) => draft.id)).toEqual([
      otherId,
    ]);
  });

  test("formats a deterministic markdown appendix with explicit change semantics", () => {
    Date.now = () => 1_700_000_000_000;

    drafts.getState().addDraft(
      OWNER,
      buildInput({
        filePath: "packages/frontend/src/beta.ts",
        diffScope: "target",
        startLine: 30,
        endLine: 30,
        text: "Beta line comment",
        codeContext: [
          { lineNumber: 29, text: "before", isSelected: false },
          { lineNumber: 30, text: "selected", isSelected: true },
        ],
      }),
    );
    drafts.getState().addDraft(
      OWNER,
      buildInput({
        filePath: "packages/frontend/src/alpha.ts",
        diffScope: "uncommitted",
        startLine: 12,
        endLine: 15,
        side: "old",
        text: "Alpha range comment",
        codeContext: [
          { lineNumber: 12, text: "removed one", isSelected: true },
          { lineNumber: 13, text: "removed two", isSelected: true },
        ],
      }),
    );

    expect(drafts.getState().formatPendingBatchMessage(OWNER)).toBe(
      [
        "## Git Diff Comments",
        "",
        "### Comment 1",
        "File: `packages/frontend/src/alpha.ts`",
        "Diff: uncommitted changes",
        "Change: removed",
        "Lines: 12-15",
        "Context:",
        "```ts",
        "12 | removed one",
        "13 | removed two",
        "```",
        "Instruction: Alpha range comment",
        "",
        "### Comment 2",
        "File: `packages/frontend/src/beta.ts`",
        "Diff: branch changes",
        "Change: added",
        "Lines: 30",
        "Context:",
        "```ts",
        "30 | selected",
        "```",
        "Instruction: Beta line comment",
      ].join("\n"),
    );
  });

  test("formats multiline instructions inline while keeping selected-line-only context", () => {
    drafts.getState().addDraft(
      OWNER,
      buildInput({
        diffScope: "target",
        startLine: 5,
        endLine: 5,
        text: "First line\nSecond line",
        codeContext: [{ lineNumber: 5, text: "target", isSelected: true }],
      }),
    );

    expect(drafts.getState().formatPendingBatchMessage(OWNER)).toContain(
      "Instruction: First line\nSecond line",
    );
    expect(drafts.getState().formatPendingBatchMessage(OWNER)).toContain(
      ["Context:", "```ts", "5 | target", "```"].join("\n"),
    );
    expect(drafts.getState().formatPendingBatchMessage(OWNER)).toContain("Diff: branch changes");
  });

  test("schedules a coalesced background write and persists on flush", () => {
    const storage = createMemoryStorage();
    const scheduledTasks: Array<() => void> = [];
    createDrafts({
      storage,
      scheduleTask: (callback) => {
        scheduledTasks.push(callback);
        return () => {};
      },
    });

    drafts.getState().addDraft(OWNER, buildInput());

    expect(scheduledTasks.length).toBeGreaterThan(0);
    expect(storage.getItem(OWNER)).toBeNull();

    drafts.getState().flush();

    const readResult = readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER });
    expect(readResult.status).toBe("restored");
    if (readResult.status !== "restored") {
      throw new Error("Expected restored comments.");
    }
    expect(readResult.comments).toHaveLength(1);
    expect(readResult.comments[0]).toMatchObject({
      filePath: "packages/frontend/src/file-a.ts",
      text: "Initial note",
      language: "ts",
    });
    expect(drafts.getState().getPersistenceWarning(OWNER)).toBeNull();
  });

  test("saveAll reports a failed write and keeps the unsaved drafts", () => {
    const storage = createSwitchableStorage(createMemoryStorage());
    createDrafts({ storage, scheduleTask: () => () => {} });
    drafts.getState().addDraft(OWNER, buildInput());
    storage.use(createThrowingStorage());

    expect(() => drafts.saveAll()).toThrow(
      "Could not save inline comments. Failed to persist git diff comment storage key",
    );
    drafts.dispose();

    expect(drafts.getState().getDraftCount(OWNER)).toBe(1);
    storage.use(createMemoryStorage());
    drafts.getState().flush();
    expect(readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER }).status).toBe(
      "restored",
    );
  });

  test("hydrates stored comments as pending and keeps in-memory owners", () => {
    const storage = createMemoryStorage();
    const updatedAt = new Date();
    writeStoredPayload(storage, OWNER, [buildStoredComment()], updatedAt.toISOString());
    writeStoredPayload(storage, OTHER_OWNER, [buildStoredComment({ id: "other-comment" })]);
    createDrafts({ storage });

    drafts
      .getState()
      .addDraft(
        OTHER_OWNER,
        buildInput({ filePath: "packages/frontend/src/local.ts", text: "Local note" }),
      );

    expect(drafts.getState().hydratedOwners[OWNER] ?? false).toBe(false);
    drafts.getState().hydrate(OWNER);

    expect(drafts.getState().hydratedOwners[OWNER]).toBe(true);
    const hydrated = drafts.getState().draftsByOwner[OWNER]?.[0];
    expect(hydrated).toMatchObject({
      id: "stored-comment",
      filePath: "packages/frontend/src/file-a.ts",
      diffScope: "uncommitted",
      side: "new",
      startLine: 4,
      endLine: 6,
      text: "Stored instruction",
      codeContext: [{ lineNumber: 5, text: "stored line", isSelected: true }],
      language: "ts",
      createdAt: 1_700_000_000_000,
      updatedAt: updatedAt.getTime(),
      submissionId: null,
      status: "pending",
    });
    expect(requireDraftRevision(OWNER, 0)).toBeGreaterThan(0);
    drafts.getState().hydrate(OTHER_OWNER);
    expect(drafts.getState().draftsByOwner[OTHER_OWNER]?.map((draft) => draft.text)).toEqual([
      "Local note",
    ]);
  });

  test("drops comments for files missing from a loaded scope once and writes immediately", () => {
    const storage = createMemoryStorage();
    createDrafts({ storage });
    drafts.getState().addDraft(OWNER, buildInput({ filePath: "packages/frontend/src/present.ts" }));
    drafts.getState().addDraft(OWNER, buildInput({ filePath: "packages/frontend/src/missing.ts" }));

    drafts
      .getState()
      .dropDraftsForMissingFiles(
        OWNER,
        "uncommitted",
        new Set(["packages/frontend/src/present.ts"]),
      );

    expect(drafts.getState().draftsByOwner[OWNER]?.map((draft) => draft.filePath)).toEqual([
      "packages/frontend/src/present.ts",
    ]);

    const firstWrite = readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER });
    expect(firstWrite.status).toBe("restored");
    if (firstWrite.status !== "restored") {
      throw new Error("Expected restored comments.");
    }
    expect(firstWrite.comments.map((comment) => comment.filePath)).toEqual([
      "packages/frontend/src/present.ts",
    ]);

    drafts.getState().dropDraftsForMissingFiles(OWNER, "uncommitted", new Set<string>());
    expect(drafts.getState().draftsByOwner[OWNER]?.map((draft) => draft.filePath)).toEqual([
      "packages/frontend/src/present.ts",
    ]);
  });

  test("keeps comments in memory and warns when a write is oversized", () => {
    const storage = createMemoryStorage();
    createDrafts({ storage });
    drafts.getState().addDraft(OWNER, buildInput({ text: "x".repeat(131_072) }));

    drafts.getState().flush();

    expect(drafts.getState().getPersistenceWarning(OWNER)).toBe("oversized");
    expect(drafts.getState().getDraftCount(OWNER)).toBe(1);
    expect(storage.getItem(OWNER)).toBeNull();
  });

  test("keeps an oversized owner unsaved after a background flush and each final save", () => {
    const storage = createMemoryStorage();
    const scheduledTasks: Array<() => void> = [];
    createDrafts({
      storage,
      scheduleTask: (callback) => {
        scheduledTasks.push(callback);
        return () => {};
      },
    });
    drafts.getState().addDraft(OWNER, buildInput({ text: "x".repeat(131_072) }));
    for (const task of scheduledTasks.splice(0)) task();

    expect(() => drafts.saveAll()).toThrow("The inline comments are too large to save.");
    expect(() => drafts.saveAll()).toThrow("The inline comments are too large to save.");
    expect(drafts.getState().getDraftCount(OWNER)).toBe(1);
    expect(storage.getItem(OWNER)).toBeNull();
  });

  test("keeps comments in memory and reports storage unavailability", () => {
    createDrafts({ storage: createThrowingStorage() });
    drafts.getState().addDraft(OWNER, buildInput());

    drafts.getState().flush();

    expect(drafts.getState().getPersistenceWarning(OWNER)).toBe("storage_unavailable");
    expect(drafts.getState().getDraftCount(OWNER)).toBe(1);
    expect(persistenceErrors.map((error) => error.message)).toEqual([
      `Failed to persist git diff comment storage key "${OWNER}".`,
    ]);
  });

  test("reports storage unavailability when hydration fails", () => {
    createDrafts({ storage: createThrowingStorage() });

    drafts.getState().hydrate(OWNER);

    expect(drafts.getState().hydratedOwners[OWNER]).toBe(true);
    expect(drafts.getState().getPersistenceWarning(OWNER)).toBe("storage_unavailable");
    expect(persistenceErrors).toHaveLength(1);
  });

  test("clears the storage unavailability warning after a successful write", () => {
    const storage = createSwitchableStorage(createThrowingStorage());
    createDrafts({ storage });
    drafts.getState().hydrate(OWNER);
    expect(drafts.getState().getPersistenceWarning(OWNER)).toBe("storage_unavailable");

    storage.use(createMemoryStorage());
    drafts.getState().addDraft(OWNER, buildInput());
    drafts.getState().flush();

    expect(drafts.getState().getPersistenceWarning(OWNER)).toBeNull();
    expect(drafts.getState().getDraftCount(OWNER)).toBe(1);
  });
  test("isolates owner hydration failures and successful saves across tasks, sessions, and workspaces", () => {
    const workspaceOwner = toInlineCommentDraftStorageKey({
      workspaceId: "workspace-1",
      workspaceSessionId: "task-1",
    });
    const otherWorkspace = toInlineCommentDraftStorageKey({
      workspaceId: "workspace-2",
      workspaceSessionId: "task-1",
    });
    const storage = createMemoryStorage();
    const read = storage.getItem;
    storage.getItem = (key) => {
      if (key === OWNER) throw new Error("Task storage failed");
      return read(key);
    };
    createDrafts({ storage });
    const store = drafts.getState();
    store.hydrate(OWNER);
    expect(drafts.getState().hydratedOwners[workspaceOwner]).toBeUndefined();
    store.hydrate(workspaceOwner);
    store.hydrate(otherWorkspace);
    store.addDraft(workspaceOwner, buildInput({ text: "Workspace comment" }));
    store.addDraft(otherWorkspace, buildInput({ text: "Other workspace comment" }));
    store.flush();
    expect(store.getPersistenceWarning(OWNER)).toBe("storage_unavailable");
    expect(store.getPersistenceWarning(workspaceOwner)).toBeNull();
    expect(store.getPersistenceWarning(otherWorkspace)).toBeNull();
    expect(store.getDraftCount(OWNER)).toBe(0);
    expect(store.getPendingDrafts(workspaceOwner).map((draft) => draft.text)).toEqual([
      "Workspace comment",
    ]);
    drafts.dispose();
    createDrafts({ storage });
    drafts.getState().hydrate(workspaceOwner);
    expect(
      drafts
        .getState()
        .getPendingDrafts(workspaceOwner)
        .map((draft) => draft.text),
    ).toEqual(["Workspace comment"]);
    expect(drafts.getState().getDraftCount(otherWorkspace)).toBe(0);
  });
});
