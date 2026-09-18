import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  toInlineCommentDraftStorageKey,
  readInlineCommentDraftsFromStorage,
  type PersistedInlineCommentDraft,
} from "./inline-comment-draft-storage";
import {
  type AddInlineCommentDraftInput,
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftPersistenceErrorReporter,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  useInlineCommentDraftStore,
} from "./use-inline-comment-draft-store";

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

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

const requireDraftRevision = (ownerKey: string, index: number): number => {
  const revision = useInlineCommentDraftStore.getState().draftsByOwner[ownerKey]?.[index]?.revision;
  if (revision == null) {
    throw new Error(`Expected draft revision at index ${index}`);
  }
  return revision;
};

describe("use-inline-comment-draft-store", () => {
  beforeEach(() => {
    resetInlineCommentDraftStoreForTests();
    setInlineCommentDraftStorageForTests(createMemoryStorage());
    setInlineCommentDraftScheduleTaskForTests(() => () => {});
    persistenceErrors = [];
    setInlineCommentDraftPersistenceErrorReporter((error) => {
      persistenceErrors.push(error);
    });
  });

  afterEach(() => {
    Date.now = originalDateNow;
    resetInlineCommentDraftStoreForTests();
  });

  test("drops submitted comments from the owner after a successful send", () => {
    Date.now = () => 1_700_000_000_000;

    const firstId = useInlineCommentDraftStore.getState().addDraft(OWNER, buildInput());
    const secondId = useInlineCommentDraftStore.getState().addDraft(
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

    const addedState = useInlineCommentDraftStore.getState();
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
      useInlineCommentDraftStore
        .getState()
        .draftsByOwner[OWNER]?.find((draft) => draft.id === firstId)?.text,
    ).toBe("Updated note");
    const pendingSnapshots = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts(OWNER)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    Date.now = () => 1_700_000_000_100;
    const submissionId = useInlineCommentDraftStore
      .getState()
      .beginSubmittingDrafts(OWNER, pendingSnapshots);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }
    useInlineCommentDraftStore.getState().completeSubmittingDrafts(submissionId);

    const submittedState = useInlineCommentDraftStore.getState();
    expect(submittedState.getDraftCount(OWNER)).toBe(0);
    expect(submittedState.getFileDraftCount(OWNER, "packages/frontend/src/file-a.ts")).toBe(0);
    expect(submittedState.draftsByOwner[OWNER]).toEqual([]);
  });

  test("removes only the submitted snapshot when another pending draft changes in flight", () => {
    Date.now = () => 1_700_000_000_000;

    const firstId = useInlineCommentDraftStore.getState().addDraft(OWNER, buildInput());
    useInlineCommentDraftStore.getState().addDraft(
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

    const sentSnapshot = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts(OWNER)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    Date.now = () => 1_700_000_000_050;
    useInlineCommentDraftStore
      .getState()
      .updateDraft(OWNER, firstId, "First note updated after send start");

    Date.now = () => 1_700_000_000_100;
    const submissionId = useInlineCommentDraftStore
      .getState()
      .beginSubmittingDrafts(OWNER, sentSnapshot);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }
    useInlineCommentDraftStore.getState().completeSubmittingDrafts(submissionId);

    const drafts = useInlineCommentDraftStore.getState().draftsByOwner[OWNER] ?? [];
    expect(drafts.find((draft) => draft.id === firstId)?.status).toBe("pending");
    expect(drafts.some((draft) => draft.filePath === "packages/frontend/src/file-b.ts")).toBe(
      false,
    );
  });

  test("rejects editing or removing a comment while that exact draft is being sent", () => {
    const draftId = useInlineCommentDraftStore.getState().addDraft(OWNER, buildInput());
    const snapshot = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts(OWNER)
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    const submissionId = useInlineCommentDraftStore
      .getState()
      .beginSubmittingDrafts(OWNER, snapshot);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }

    expect(() =>
      useInlineCommentDraftStore.getState().updateDraft(OWNER, draftId, "Edited"),
    ).toThrow("Cannot edit a git diff comment while it is being sent.");
    expect(() => useInlineCommentDraftStore.getState().removeDraft(OWNER, draftId)).toThrow(
      "Cannot remove a git diff comment while it is being sent.",
    );
  });

  test("excludes submitting drafts from new pending batches and clears submitting locks per batch", () => {
    const firstId = useInlineCommentDraftStore.getState().addDraft(OWNER, buildInput());
    const secondId = useInlineCommentDraftStore.getState().addDraft(
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

    const firstSubmissionId = useInlineCommentDraftStore
      .getState()
      .beginSubmittingDrafts(OWNER, firstSnapshot);
    if (firstSubmissionId == null) {
      throw new Error("Expected first submission id");
    }
    expect(
      useInlineCommentDraftStore
        .getState()
        .getPendingDrafts(OWNER)
        .map((draft) => draft.id),
    ).toEqual([secondId]);
    expect(useInlineCommentDraftStore.getState().getDraftCount(OWNER)).toBe(1);

    const secondSubmissionId = useInlineCommentDraftStore
      .getState()
      .beginSubmittingDrafts(OWNER, secondSnapshot);
    if (secondSubmissionId == null) {
      throw new Error("Expected second submission id");
    }
    expect(
      (useInlineCommentDraftStore.getState().draftsByOwner[OWNER] ?? []).filter(
        (draft) => draft.status === "submitting",
      ),
    ).toHaveLength(2);
    expect(useInlineCommentDraftStore.getState().getPendingDrafts(OWNER)).toEqual([]);

    useInlineCommentDraftStore.getState().restoreSubmittingDrafts(firstSubmissionId);
    expect(
      useInlineCommentDraftStore
        .getState()
        .getPendingDrafts(OWNER)
        .map((draft) => draft.id),
    ).toEqual([firstId]);
    expect(
      (useInlineCommentDraftStore.getState().draftsByOwner[OWNER] ?? []).reduce<string[]>(
        (draftIds, draft) => {
          if (draft.status === "submitting") {
            draftIds.push(draft.id);
          }
          return draftIds;
        },
        [],
      ),
    ).toEqual([secondId]);
  });

  test("keeps owners isolated and completes a send by submission id across owners", () => {
    const firstId = useInlineCommentDraftStore.getState().addDraft(OWNER, buildInput());
    const otherId = useInlineCommentDraftStore.getState().addDraft(
      OTHER_OWNER,
      buildInput({
        filePath: "packages/frontend/src/other.ts",
        text: "Other task note",
      }),
    );

    const firstSnapshot = [{ id: firstId, revision: requireDraftRevision(OWNER, 0) }];
    const submissionId = useInlineCommentDraftStore
      .getState()
      .beginSubmittingDrafts(OWNER, firstSnapshot);
    if (submissionId == null) {
      throw new Error("Expected submission id");
    }

    expect(useInlineCommentDraftStore.getState().getDraftCount(OWNER)).toBe(0);
    expect(useInlineCommentDraftStore.getState().getDraftCount(OTHER_OWNER)).toBe(1);

    useInlineCommentDraftStore.getState().completeSubmittingDrafts(submissionId);

    expect(useInlineCommentDraftStore.getState().draftsByOwner[OWNER]).toEqual([]);
    expect(
      useInlineCommentDraftStore.getState().draftsByOwner[OTHER_OWNER]?.map((draft) => draft.id),
    ).toEqual([otherId]);
  });

  test("formats a deterministic markdown appendix with explicit change semantics", () => {
    Date.now = () => 1_700_000_000_000;

    useInlineCommentDraftStore.getState().addDraft(
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
    useInlineCommentDraftStore.getState().addDraft(
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

    expect(useInlineCommentDraftStore.getState().formatPendingBatchMessage(OWNER)).toBe(
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
    useInlineCommentDraftStore.getState().addDraft(
      OWNER,
      buildInput({
        diffScope: "target",
        startLine: 5,
        endLine: 5,
        text: "First line\nSecond line",
        codeContext: [{ lineNumber: 5, text: "target", isSelected: true }],
      }),
    );

    expect(useInlineCommentDraftStore.getState().formatPendingBatchMessage(OWNER)).toContain(
      "Instruction: First line\nSecond line",
    );
    expect(useInlineCommentDraftStore.getState().formatPendingBatchMessage(OWNER)).toContain(
      ["Context:", "```ts", "5 | target", "```"].join("\n"),
    );
    expect(useInlineCommentDraftStore.getState().formatPendingBatchMessage(OWNER)).toContain(
      "Diff: branch changes",
    );
  });

  test("schedules a coalesced background write and persists on flush", async () => {
    const storage = createMemoryStorage();
    const scheduledTasks: Array<() => void> = [];
    setInlineCommentDraftStorageForTests(storage);
    setInlineCommentDraftScheduleTaskForTests((callback) => {
      scheduledTasks.push(callback);
      return () => {};
    });

    useInlineCommentDraftStore.getState().addDraft(OWNER, buildInput());

    expect(scheduledTasks.length).toBeGreaterThan(0);
    expect(storage.getItem(OWNER)).toBeNull();

    await useInlineCommentDraftStore.getState().flush();

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
    expect(useInlineCommentDraftStore.getState().getPersistenceWarning(OWNER)).toBeNull();
  });

  test("hydrates stored comments as pending and keeps in-memory owners", () => {
    const storage = createMemoryStorage();
    const updatedAt = new Date("2026-09-18T10:00:00.000Z");
    writeStoredPayload(storage, OWNER, [buildStoredComment()], updatedAt.toISOString());
    writeStoredPayload(storage, OTHER_OWNER, [buildStoredComment({ id: "other-comment" })]);
    setInlineCommentDraftStorageForTests(storage);

    useInlineCommentDraftStore
      .getState()
      .addDraft(
        OTHER_OWNER,
        buildInput({ filePath: "packages/frontend/src/local.ts", text: "Local note" }),
      );

    expect(useInlineCommentDraftStore.getState().isHydrated).toBe(false);
    useInlineCommentDraftStore.getState().hydrate();

    expect(useInlineCommentDraftStore.getState().isHydrated).toBe(true);
    const hydrated = useInlineCommentDraftStore.getState().draftsByOwner[OWNER]?.[0];
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
    expect(
      useInlineCommentDraftStore.getState().draftsByOwner[OTHER_OWNER]?.map((draft) => draft.text),
    ).toEqual(["Local note"]);
  });

  test("drops comments for files missing from a loaded scope once and writes immediately", async () => {
    const storage = createMemoryStorage();
    setInlineCommentDraftStorageForTests(storage);
    useInlineCommentDraftStore
      .getState()
      .addDraft(OWNER, buildInput({ filePath: "packages/frontend/src/present.ts" }));
    useInlineCommentDraftStore
      .getState()
      .addDraft(OWNER, buildInput({ filePath: "packages/frontend/src/missing.ts" }));

    useInlineCommentDraftStore
      .getState()
      .dropDraftsForMissingFiles(
        OWNER,
        "uncommitted",
        new Set(["packages/frontend/src/present.ts"]),
      );
    await useInlineCommentDraftStore.getState().flush();

    expect(
      useInlineCommentDraftStore.getState().draftsByOwner[OWNER]?.map((draft) => draft.filePath),
    ).toEqual(["packages/frontend/src/present.ts"]);

    const firstWrite = readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER });
    expect(firstWrite.status).toBe("restored");
    if (firstWrite.status !== "restored") {
      throw new Error("Expected restored comments.");
    }
    expect(firstWrite.comments.map((comment) => comment.filePath)).toEqual([
      "packages/frontend/src/present.ts",
    ]);

    useInlineCommentDraftStore
      .getState()
      .dropDraftsForMissingFiles(OWNER, "uncommitted", new Set<string>());
    expect(
      useInlineCommentDraftStore.getState().draftsByOwner[OWNER]?.map((draft) => draft.filePath),
    ).toEqual(["packages/frontend/src/present.ts"]);
  });

  test("keeps comments in memory and warns when a write is oversized", async () => {
    const storage = createMemoryStorage();
    setInlineCommentDraftStorageForTests(storage);
    useInlineCommentDraftStore
      .getState()
      .addDraft(OWNER, buildInput({ text: "x".repeat(131_072) }));

    await useInlineCommentDraftStore.getState().flush();

    expect(useInlineCommentDraftStore.getState().getPersistenceWarning(OWNER)).toBe("oversized");
    expect(useInlineCommentDraftStore.getState().getDraftCount(OWNER)).toBe(1);
    expect(storage.getItem(OWNER)).toBeNull();
  });

  test("keeps comments in memory and reports storage unavailability", async () => {
    setInlineCommentDraftStorageForTests(createThrowingStorage());
    useInlineCommentDraftStore.getState().addDraft(OWNER, buildInput());

    await useInlineCommentDraftStore.getState().flush();

    expect(useInlineCommentDraftStore.getState().getPersistenceWarning(OWNER)).toBe(
      "storage_unavailable",
    );
    expect(useInlineCommentDraftStore.getState().getDraftCount(OWNER)).toBe(1);
    expect(persistenceErrors.map((error) => error.message)).toEqual([
      `Failed to persist git diff comment storage key "${OWNER}".`,
    ]);
  });

  test("reports storage unavailability when hydration cannot read storage", () => {
    setInlineCommentDraftStorageForTests(createThrowingStorage());

    useInlineCommentDraftStore.getState().hydrate();

    expect(useInlineCommentDraftStore.getState().isHydrated).toBe(true);
    expect(useInlineCommentDraftStore.getState().getPersistenceWarning(OWNER)).toBe(
      "storage_unavailable",
    );
    expect(persistenceErrors).toHaveLength(1);
  });
});
