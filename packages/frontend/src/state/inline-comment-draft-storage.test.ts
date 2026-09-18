import { describe, expect, test } from "bun:test";
import {
  INLINE_COMMENT_DRAFT_STORAGE_MAX_BYTES,
  INLINE_COMMENT_DRAFT_STORAGE_TTL_MS,
  type PersistedInlineCommentDraft,
  isInlineCommentDraftStorageKey,
  parseInlineCommentDraftStorageKey,
  parseInlineCommentDraftsPayload,
  readAllInlineCommentDraftsFromStorage,
  readInlineCommentDraftsFromStorage,
  serializeInlineCommentDraftsPayload,
  toInlineCommentDraftStorageKey,
  writeInlineCommentDraftsToStorage,
} from "./inline-comment-draft-storage";

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

const OWNER = toInlineCommentDraftStorageKey({
  workspaceId: "workspace:one",
  taskId: "task/one",
});
const OTHER_OWNER = toInlineCommentDraftStorageKey({
  workspaceId: "workspace:one",
  taskId: "task/two",
});

const buildComment = (
  overrides: Partial<PersistedInlineCommentDraft> = {},
): PersistedInlineCommentDraft => ({
  id: "comment-1",
  filePath: "packages/frontend/src/alpha.ts",
  diffScope: "uncommitted",
  side: "new",
  startLine: 12,
  endLine: 15,
  text: "Keep this branch explicit.",
  codeContext: [
    { lineNumber: 12, text: "removed one", isSelected: true },
    { lineNumber: 13, text: "removed two", isSelected: true },
  ],
  language: "ts",
  createdAt: 1_700_000_000_000,
  ...overrides,
});

describe("inline comment draft storage", () => {
  test("round-trips comments under an encoded workspace and task key", () => {
    const storage = createMemoryStorage();
    const comments = [buildComment()];
    const updatedAt = "2026-09-18T10:00:00.000Z";

    const result = writeInlineCommentDraftsToStorage({
      storage,
      ownerKey: OWNER,
      comments,
      updatedAt,
    });

    expect(result.status).toBe("serialized");
    expect(isInlineCommentDraftStorageKey(OWNER)).toBe(true);
    expect(parseInlineCommentDraftStorageKey(OWNER)).toEqual({
      workspaceId: "workspace:one",
      taskId: "task/one",
    });
    expect(storage.getItem(OWNER)).not.toBeNull();
    expect(readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER })).toEqual({
      status: "restored",
      comments,
      updatedAt,
    });
  });

  test("returns empty for a missing key and rejects an identity mismatch", () => {
    const storage = createMemoryStorage();
    expect(readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER })).toEqual({
      status: "empty",
    });

    writeInlineCommentDraftsToStorage({
      storage,
      ownerKey: OWNER,
      comments: [buildComment()],
      updatedAt: new Date().toISOString(),
    });
    const storedPayload = storage.getItem(OWNER);
    if (storedPayload === null) {
      throw new Error("Expected a stored payload.");
    }
    storage.setItem(OTHER_OWNER, storedPayload);

    expect(readInlineCommentDraftsFromStorage({ storage, ownerKey: OTHER_OWNER })).toMatchObject({
      status: "invalid",
    });
    expect(storage.getItem(OTHER_OWNER)).toBeNull();
    expect(storage.getItem(OWNER)).not.toBeNull();
  });

  test("rejects invalid JSON, invalid bodies, and malformed keys", () => {
    const storage = createMemoryStorage();
    storage.setItem(OWNER, "{not-json");

    expect(readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER })).toMatchObject({
      status: "invalid",
    });
    expect(storage.getItem(OWNER)).toBeNull();

    expect(parseInlineCommentDraftStorageKey(`${OWNER}:extra`)).toBeNull();
    expect(parseInlineCommentDraftStorageKey("openducktor:other:v1:a:b")).toBeNull();
    expect(parseInlineCommentDraftStorageKey(OWNER)).toEqual({
      workspaceId: "workspace:one",
      taskId: "task/one",
    });
  });

  test("removes an empty stored value", () => {
    const storage = createMemoryStorage();
    storage.setItem(OWNER, "");

    expect(readInlineCommentDraftsFromStorage({ storage, ownerKey: OWNER })).toMatchObject({
      status: "invalid",
    });
    expect(storage.getItem(OWNER)).toBeNull();
  });

  test("expires entries after the draft TTL and rejects future update dates", () => {
    const storage = createMemoryStorage();
    const updatedAt = new Date("2026-09-01T10:00:00.000Z");
    writeInlineCommentDraftsToStorage({
      storage,
      ownerKey: OWNER,
      comments: [buildComment()],
      updatedAt: updatedAt.toISOString(),
    });

    expect(
      readInlineCommentDraftsFromStorage({
        storage,
        ownerKey: OWNER,
        now: new Date(updatedAt.getTime() + INLINE_COMMENT_DRAFT_STORAGE_TTL_MS - 1),
      }).status,
    ).toBe("restored");
    expect(
      readInlineCommentDraftsFromStorage({
        storage,
        ownerKey: OWNER,
        now: new Date(updatedAt.getTime() + INLINE_COMMENT_DRAFT_STORAGE_TTL_MS),
      }).status,
    ).toBe("expired");
    expect(storage.getItem(OWNER)).toBeNull();

    expect(
      parseInlineCommentDraftsPayload({
        raw: JSON.stringify({
          version: 1,
          workspaceId: "workspace:one",
          taskId: "task/one",
          updatedAt: new Date(updatedAt.getTime() + 60_000).toISOString(),
          comments: [buildComment()],
        }),
        ownerKey: OWNER,
        now: updatedAt,
      }),
    ).toMatchObject({ status: "invalid" });
  });

  test("marks oversized payloads and removes the stored key", () => {
    const storage = createMemoryStorage();
    const oversizedComment = buildComment({
      text: "x".repeat(INLINE_COMMENT_DRAFT_STORAGE_MAX_BYTES),
    });
    const serialized = serializeInlineCommentDraftsPayload({
      ownerKey: OWNER,
      comments: [oversizedComment],
      updatedAt: new Date().toISOString(),
    });
    expect(serialized.status).toBe("oversized");

    storage.setItem(OWNER, "existing");
    expect(
      writeInlineCommentDraftsToStorage({
        storage,
        ownerKey: OWNER,
        comments: [oversizedComment],
        updatedAt: new Date().toISOString(),
      }).status,
    ).toBe("oversized");
    expect(storage.getItem(OWNER)).toBeNull();
  });

  test("removes an empty comment set instead of writing a payload", () => {
    const storage = createMemoryStorage();
    storage.setItem(OWNER, "existing");

    expect(
      writeInlineCommentDraftsToStorage({
        storage,
        ownerKey: OWNER,
        comments: [],
        updatedAt: new Date().toISOString(),
      }),
    ).toEqual({ status: "empty" });
    expect(storage.getItem(OWNER)).toBeNull();
  });

  test("reads all valid owners and removes invalid, expired, and oversized entries", () => {
    const storage = createMemoryStorage();
    const now = new Date("2026-09-18T10:00:00.000Z");
    const updatedAt = now.toISOString();

    writeInlineCommentDraftsToStorage({
      storage,
      ownerKey: OWNER,
      comments: [buildComment()],
      updatedAt,
    });
    writeInlineCommentDraftsToStorage({
      storage,
      ownerKey: OTHER_OWNER,
      comments: [buildComment({ id: "comment-2", filePath: "packages/frontend/src/beta.ts" })],
      updatedAt,
    });
    const expiredOwner = toInlineCommentDraftStorageKey({
      workspaceId: "workspace:one",
      taskId: "task/expired",
    });
    writeInlineCommentDraftsToStorage({
      storage,
      ownerKey: expiredOwner,
      comments: [buildComment({ id: "comment-3" })],
      updatedAt: new Date(now.getTime() - INLINE_COMMENT_DRAFT_STORAGE_TTL_MS).toISOString(),
    });
    storage.setItem("openducktor:git-diff-comments:v1:broken", "{");

    expect(readAllInlineCommentDraftsFromStorage({ storage, now })).toEqual([
      { ownerKey: OWNER, comments: [buildComment()], updatedAt },
      {
        ownerKey: OTHER_OWNER,
        comments: [buildComment({ id: "comment-2", filePath: "packages/frontend/src/beta.ts" })],
        updatedAt,
      },
    ]);
    expect(storage.getItem(expiredOwner)).toBeNull();
    expect(storage.getItem("openducktor:git-diff-comments:v1:broken")).toBeNull();
  });
});
