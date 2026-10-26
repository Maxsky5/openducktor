import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { PullRequestReviewActivity } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { type ClientStorage, createMemoryClientStorage } from "../platform/client-storage";
import { createFeedbackFake } from "../test-support/feedback-fake";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  countPullRequestComments,
  filterPullRequestComments,
  persistTaskExecutionCiCommentFilters,
  readTaskExecutionCiCommentFilters,
  useHideResolvedComments,
} from "./pull-request-comment-filters";

const comment = (
  id: string,
  author: string,
  overrides: Pick<Partial<PullRequestReviewActivity>, "createdAt" | "isResolved"> = {},
): PullRequestReviewActivity => ({
  id,
  author,
  authorAvatarUrl: null,
  body: `Comment ${id}`,
  patch: null,
  suggestionPatches: [],
  suggestionWarning: null,
  url: null,
  createdAt: "2026-07-10T10:00:00Z",
  updatedAt: null,
  path: "src/index.ts",
  line: 1,
  threadId: `thread-${id}`,
  isResolved: false,
  source: "review_thread",
  ...overrides,
});

const comments = [
  comment("old-human", "maria", { createdAt: "2026-07-10T09:00:00Z" }),
  comment("bot", "review-bot[bot]", { createdAt: "2026-07-10T11:00:00Z" }),
  comment("resolved-human", "sam", { createdAt: "2026-07-10T12:00:00Z", isResolved: true }),
];

const ids = (entries: readonly PullRequestReviewActivity[]) => entries.map((entry) => entry.id);

describe("pull request comment filters", () => {
  test("shows the comments of each author filter newest first", () => {
    expect(ids(filterPullRequestComments(comments, "all", false))).toEqual([
      "resolved-human",
      "bot",
      "old-human",
    ]);
    expect(ids(filterPullRequestComments(comments, "humans", false))).toEqual([
      "resolved-human",
      "old-human",
    ]);
    expect(ids(filterPullRequestComments(comments, "bots", false))).toEqual(["bot"]);
  });

  test("hides resolved comments from the list and the counts", () => {
    expect(ids(filterPullRequestComments(comments, "humans", true))).toEqual(["old-human"]);
    expect(countPullRequestComments(comments, false)).toEqual({ all: 3, humans: 2, bots: 1 });
    expect(countPullRequestComments(comments, true)).toEqual({ all: 2, humans: 1, bots: 1 });
  });

  test("reads current persisted filters and rejects malformed storage", () => {
    const storage = createMemoryClientStorage();
    expect(readTaskExecutionCiCommentFilters(storage)).toEqual({ hideResolved: false });
    persistTaskExecutionCiCommentFilters(storage, { hideResolved: true });
    expect(readTaskExecutionCiCommentFilters(storage)).toEqual({ hideResolved: true });

    const storageKey = storage.key(0);
    expect(storageKey).not.toBeNull();
    if (storageKey) storage.setItem(storageKey, "not-json");
    expect(() => readTaskExecutionCiCommentFilters(storage)).toThrow(
      "Failed to read persisted CI comment filters",
    );
  });

  test("propagates filter storage access failures", () => {
    const storage: ClientStorage = {
      ...createMemoryClientStorage(),
      length: 0,
      getItem: () => {
        throw new Error("storage read failed");
      },
      setItem: () => {
        throw new Error("storage write failed");
      },
    };
    expect(() => readTaskExecutionCiCommentFilters(storage)).toThrow(
      "Failed to read persisted CI comment filters",
    );
    expect(() => persistTaskExecutionCiCommentFilters(storage, { hideResolved: true })).toThrow(
      "Failed to persist CI comment filters",
    );
  });
});

describe("useHideResolvedComments", () => {
  const renderChoice = (storage: ClientStorage, feedback = createFeedbackFake()) => {
    const connection = createTestClientConnection({ storage, feedback });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    return renderHook(useHideResolvedComments, { wrapper });
  };

  test("keeps the choice in the storage of the host connection", () => {
    const storage = createMemoryClientStorage();
    const first = renderChoice(storage);
    expect(first.result.current.hideResolved).toBe(false);
    act(() => first.result.current.setHideResolved(true));
    expect(first.result.current.hideResolved).toBe(true);
    first.unmount();

    const restored = renderChoice(storage);
    expect(restored.result.current.hideResolved).toBe(true);
    restored.unmount();

    const otherHost = renderChoice(createMemoryClientStorage());
    expect(otherHost.result.current.hideResolved).toBe(false);
    otherHost.unmount();
  });

  test("keeps the current choice and tells the user when the save fails", () => {
    const memory = createMemoryClientStorage();
    const storage: ClientStorage = {
      get length() {
        return memory.length;
      },
      key: (index) => memory.key(index),
      getItem: (key) => memory.getItem(key),
      removeItem: (key) => memory.removeItem(key),
      setItem: () => {
        throw new Error("Device storage is full.");
      },
    };
    const feedback = createFeedbackFake();
    const view = renderChoice(storage, feedback);
    act(() => view.result.current.setHideResolved(true));
    expect(view.result.current.hideResolved).toBe(false);
    expect(feedback.shownOf("error")).toEqual([
      {
        kind: "error",
        message: "Failed to save comment filters",
        options: { description: "Failed to persist CI comment filters." },
      },
    ]);
    view.unmount();
  });
});
