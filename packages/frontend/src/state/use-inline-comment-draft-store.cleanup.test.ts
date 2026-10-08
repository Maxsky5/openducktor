import { afterEach, expect, test } from "bun:test";
import {
  INLINE_COMMENT_DRAFT_STORAGE_MAX_BYTES,
  INLINE_COMMENT_DRAFT_STORAGE_TTL_MS,
  type InlineCommentDraftStorageIdentity,
  toInlineCommentDraftStorageKey,
  writeInlineCommentDraftsToStorage,
} from "./inline-comment-draft-storage";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftPersistenceErrorReporter,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  useInlineCommentDraftStore,
} from "./use-inline-comment-draft-store";

afterEach(resetInlineCommentDraftStoreForTests);

function setup() {
  resetInlineCommentDraftStoreForTests();
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const callbacks: Array<{ run: () => void; delay: number; cancelled: boolean }> = [];
  const errors: Error[] = [];
  setInlineCommentDraftStorageForTests(storage);
  setInlineCommentDraftPersistenceErrorReporter((error) => errors.push(error));
  setInlineCommentDraftScheduleTaskForTests((run, delay) => {
    const callback = { run, delay, cancelled: false };
    callbacks.push(callback);
    return () => {
      callback.cancelled = true;
    };
  });
  const runStep = () => {
    const index = callbacks.findIndex((callback) => !callback.cancelled && callback.delay === 0);
    if (index < 0) return false;
    callbacks.splice(index, 1)[0]?.run();
    return true;
  };
  const finish = () => {
    let steps = 0;
    while (runStep()) {
      if (++steps > 100) throw new Error("Cleanup did not finish.");
    }
  };
  const seed = (
    identity: InlineCommentDraftStorageIdentity,
    updatedAt = new Date().toISOString(),
  ) => {
    const key = toInlineCommentDraftStorageKey(identity);
    writeInlineCommentDraftsToStorage({
      storage,
      ownerKey: key,
      updatedAt,
      comments: [
        {
          id: "saved",
          filePath: "a.ts",
          diffScope: "uncommitted",
          side: "new",
          startLine: 1,
          endLine: 1,
          text: "Saved comment",
          codeContext: [],
          language: null,
          createdAt: 1,
        },
      ],
    });
    return key;
  };
  return { storage, values, errors, runStep, finish, seed };
}

test.each(["task", "workspace_session"] as const)(
  "%s hydration cleans inactive records without loading their drafts",
  (kind) => {
    const { storage, values, finish, seed } = setup();
    const active = seed(
      kind === "task"
        ? { workspaceId: "active", taskId: "chat" }
        : { workspaceId: "active", workspaceSessionId: "chat" },
    );
    const staleKeys: string[] = [];
    const validKeys: string[] = [];
    for (const scope of ["task", "workspace_session"] as const) {
      const identity = (id: string): InlineCommentDraftStorageIdentity =>
        scope === "task"
          ? { workspaceId: "inactive", taskId: id }
          : { workspaceId: "inactive", workspaceSessionId: id };
      staleKeys.push(
        seed(
          identity("expired"),
          new Date(Date.now() - INLINE_COMMENT_DRAFT_STORAGE_TTL_MS).toISOString(),
        ),
      );
      const invalid = seed(identity("invalid"));
      storage.setItem(invalid, "{invalid");
      staleKeys.push(invalid);
      const oversized = seed(identity("oversized"));
      storage.setItem(oversized, "x".repeat(INLINE_COMMENT_DRAFT_STORAGE_MAX_BYTES + 1));
      staleKeys.push(oversized);
      validKeys.push(seed(identity("valid")));
    }
    values.set("other-app", "{invalid");
    const store = useInlineCommentDraftStore.getState();
    store.addDraft(active, {
      filePath: "new.ts",
      diffScope: "target",
      startLine: 1,
      endLine: 1,
      side: "new",
      text: "Newer comment",
      codeContext: [],
    });
    store.hydrate(active);
    expect(staleKeys.every((key) => values.has(key))).toBe(true);
    expect(store.getPendingDrafts(active).map((draft) => draft.text)).toEqual(["Newer comment"]);

    finish();
    expect(staleKeys.every((key) => !values.has(key))).toBe(true);
    expect(validKeys.every((key) => values.has(key))).toBe(true);
    expect(values.get("other-app")).toBe("{invalid");
    expect(useInlineCommentDraftStore.getState().hydratedOwners).toEqual({ [active]: true });
    expect(store.getPendingDrafts(active).map((draft) => draft.text)).toEqual(["Newer comment"]);
    expect(store.getPersistenceWarning(active)).toBeNull();
  },
);

test("limits background record reads and completes the pass after records shift on removal", () => {
  const { storage, values, runStep, seed } = setup();
  const active = seed({ workspaceId: "w", taskId: "active" });
  for (let index = 0; index < 70; index++) {
    seed(
      { workspaceId: "w", workspaceSessionId: `stale-${index}` },
      new Date(Date.now() - INLINE_COMMENT_DRAFT_STORAGE_TTL_MS).toISOString(),
    );
  }
  let work = 0;
  const read = storage.getItem;
  storage.getItem = (ownerKey) => {
    work++;
    return read(ownerKey);
  };
  useInlineCommentDraftStore.getState().hydrate(active);
  expect(work).toBe(1);
  work = 0;
  let steps = 0;
  while (runStep()) {
    expect(work).toBeLessThanOrEqual(32);
    work = 0;
    if (++steps > 10) throw new Error("Cleanup did not finish.");
  }
  expect(steps).toBeGreaterThan(1);
  expect(Array.from(values.keys())).toEqual([active]);
});

test("reports an inactive owner cleanup failure without changing owner warnings or retrying", () => {
  const { storage, errors, finish, seed } = setup();
  const active = seed({ workspaceId: "w", workspaceSessionId: "active" });
  const failed = seed({ workspaceId: "w", taskId: "failed" });
  const read = storage.getItem;
  storage.getItem = (key) => {
    if (key === failed) throw new Error("Cannot read inactive owner");
    return read(key);
  };
  const store = useInlineCommentDraftStore.getState();
  store.hydrate(failed);
  store.hydrate(active);
  finish();
  expect(errors).toHaveLength(2);
  expect(errors[1]?.message).toBe(
    "Failed to clean up saved Git diff comments. Check access to local storage.",
  );
  expect(store.getPendingDrafts(active)).toHaveLength(1);
  expect(store.getPersistenceWarning(failed)).toBe("storage_unavailable");
  expect(store.getPersistenceWarning(active)).toBeNull();
  store.hydrate(active);
  finish();
  expect(errors).toHaveLength(2);
});

test("keeps a record saved after cleanup starts", async () => {
  const { values, runStep, finish, seed } = setup();
  const identity = { workspaceId: "w", taskId: "active" };
  const active = seed(identity);
  useInlineCommentDraftStore.getState().hydrate(active);
  expect(runStep()).toBe(true);
  await Bun.sleep(5);
  seed(identity);
  finish();
  expect(values.has(active)).toBe(true);
});

test("keeps the snapshot complete when a key is removed between cleanup steps", () => {
  const { storage, values, runStep, finish, seed } = setup();
  storage.setItem("other-app", "value");
  for (let index = 0; index < 70; index++) {
    seed(
      { workspaceId: "w", workspaceSessionId: `stale-${index}` },
      new Date(Date.now() - INLINE_COMMENT_DRAFT_STORAGE_TTL_MS).toISOString(),
    );
  }
  const active = seed({ workspaceId: "w", taskId: "active" });
  useInlineCommentDraftStore.getState().hydrate(active);
  expect(runStep()).toBe(true);
  storage.removeItem("other-app");
  finish();
  expect(Array.from(values.keys())).toEqual([active]);
});
