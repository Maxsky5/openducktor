import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type {
  PullRequest,
  PullRequestReviewActivity,
  PullRequestReviewCheck,
  PullRequestReviewContext,
  RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createMemoryClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { useHideResolvedComments } from "@openducktor/frontend-core/review/pull-request-comment-filters";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import {
  buildChecksListItems,
  checkDetails,
  checkTimeLabel,
  commentChoiceKey,
  ciChecksViewState,
  ciReviewQueryInput,
  formatCheckDuration,
  isCommentOpen,
} from "./checks-model";
import { unknownOutcomeGuidance } from "./conflict-model";

const provider: RepositoryGitProviderContext = {
  descriptor: {
    id: "github",
    label: "GitHub",
    description: "GitHub provider.",
    capabilities: { supportsPullRequests: true, supportsPullRequestReview: true },
  },
  config: { id: "github", enabled: true, autoDetected: false },
  health: {
    providerId: "github",
    enabled: true,
    available: true,
    executablePath: "gh",
    version: "2.0.0",
    authenticated: true,
    account: "octocat",
    repositoryMappingValid: true,
  },
};

const pullRequest: PullRequest = {
  providerId: "github",
  number: 7,
  url: "https://github.com/acme/repo/pull/7",
  state: "open",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

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
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: null,
  path: "src/a.ts",
  line: 3,
  threadId: `thread-${id}`,
  isResolved: false,
  source: "review_thread",
  ...overrides,
});

const loaded: Extract<PullRequestReviewContext, { status: "loaded" }> = {
  status: "loaded",
  providerId: "github",
  pullRequest: {
    providerId: "github",
    number: 7,
    title: "Fix parser",
    url: pullRequest.url,
    state: "open",
  },
  aggregateStatus: "failure",
  checks: [
    {
      name: "test",
      workflow: "CI",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/acme/repo/actions/1",
      details: null,
      startedAt: null,
      completedAt: null,
    },
  ],
  comments: [
    comment("human", "maria", { createdAt: "2026-10-01T09:00:00Z" }),
    comment("bot", "review-bot[bot]", { createdAt: "2026-10-01T11:00:00Z" }),
    comment("resolved", "sam", { createdAt: "2026-10-01T12:00:00Z", isResolved: true }),
  ],
  reviewThreads: { openCount: 2 },
  refreshedAt: "2026-10-01T12:30:00Z",
};

const read = <Data>(data: Data | undefined, error: Error | null = null) => ({
  data,
  error,
  isPending: data === undefined && error === null,
});

describe("CI Checks state", () => {
  test("reads only a linked pull request that the provider can review", () => {
    expect(
      ciReviewQueryInput({
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest,
        unavailableReason: null,
      }),
    ).toEqual({
      repoPath: "/repo",
      taskId: "task-1",
      pullRequest: { providerId: "github", number: 7 },
    });
    expect(
      ciReviewQueryInput({
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: undefined,
        unavailableReason: null,
      }),
    ).toBeNull();
    expect(
      ciReviewQueryInput({
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest,
        unavailableReason: "Sign in.",
      }),
    ).toBeNull();
  });

  test("tells why no pull request review shows", () => {
    expect(
      ciChecksViewState({ provider: read(undefined), pullRequest, review: read(undefined) }).kind,
    ).toBe("loading");
    expect(
      ciChecksViewState({
        provider: read(provider),
        pullRequest: undefined,
        review: read(undefined),
      }),
    ).toMatchObject({ kind: "state", copy: { title: "No pull request found" }, action: null });
    expect(
      ciChecksViewState({
        provider: read(undefined, new Error("connection failed")),
        pullRequest,
        review: read(undefined),
      }),
    ).toMatchObject({
      kind: "state",
      copy: {
        title: "Pull request checks unavailable",
        detail: "Could not load the current Git provider: connection failed",
      },
      action: "retry",
    });
    expect(
      ciChecksViewState({
        provider: read(provider),
        pullRequest,
        review: read<PullRequestReviewContext>(undefined, new Error("rate limited")),
      }),
    ).toMatchObject({
      kind: "state",
      copy: { title: "Could not load CI checks", detail: "rate limited" },
      action: "retry",
    });
    expect(
      ciChecksViewState({
        provider: read(provider),
        pullRequest,
        review: read<PullRequestReviewContext>({
          status: "no_pull_request",
          providerId: "github",
          reason: "None.",
        }),
      }),
    ).toMatchObject({
      kind: "state",
      copy: { title: "No pull request found", detail: "None." },
      action: "refresh",
    });
    expect(
      ciChecksViewState({ provider: read(provider), pullRequest, review: read(loaded) }),
    ).toEqual({
      kind: "loaded",
      context: loaded,
      refreshError: null,
    });
  });

  test("keeps the last loaded review after a failed read and tells why the read failed", () => {
    expect(
      ciChecksViewState({
        provider: read(provider),
        pullRequest,
        review: read<PullRequestReviewContext>(loaded, new Error("rate limited")),
      }),
    ).toEqual({ kind: "loaded", context: loaded, refreshError: "rate limited" });
  });
});

describe("pull request comment list", () => {
  const commentIds = (items: ReturnType<typeof buildChecksListItems>) =>
    items.flatMap((item) => (item.kind === "comment" ? [item.comment.id] : []));

  test("shows checks, then comments newest first for each author filter", () => {
    const all = buildChecksListItems(loaded, "all", false);
    expect(all.map((item) => item.kind).slice(0, 3)).toEqual([
      "checks_header",
      "check",
      "comments_header",
    ]);
    expect(all[0]).toMatchObject({ aggregateStatus: "failure", summary: "1 failing", open: true });
    expect(commentIds(all)).toEqual(["resolved", "bot", "human"]);
    expect(commentIds(buildChecksListItems(loaded, "humans", false))).toEqual([
      "resolved",
      "human",
    ]);
    expect(commentIds(buildChecksListItems(loaded, "bots", false))).toEqual(["bot"]);
  });

  test("hide resolved removes resolved comments from the list and the counts", () => {
    const items = buildChecksListItems(loaded, "humans", true);
    expect(commentIds(items)).toEqual(["human"]);
    expect(items.find((item) => item.kind === "comments_header")).toMatchObject({
      counts: { all: 2, humans: 1, bots: 1 },
      total: 3,
    });
    expect(
      buildChecksListItems(
        { ...loaded, comments: [comment("x", "sam", { isResolved: true })] },
        "all",
        true,
      ),
    ).toContainEqual({
      kind: "no_comments",
      key: "no_comments",
      text: "No comments for this filter.",
    });
  });

  test("a resolved comment starts closed, and a choice holds until its resolution changes", () => {
    const open = comment("open", "maria");
    const resolved = comment("done", "sam", { isResolved: true });
    expect(isCommentOpen(open, new Map())).toBe(true);
    expect(isCommentOpen(resolved, new Map())).toBe(false);
    const choices = new Map([[commentChoiceKey(resolved), true]]);
    expect(isCommentOpen(resolved, choices)).toBe(true);
    expect(isCommentOpen({ ...resolved, isResolved: false }, choices)).toBe(true);
    expect(
      isCommentOpen(
        { ...resolved, isResolved: false },
        new Map([[commentChoiceKey(resolved), false]]),
      ),
    ).toBe(true);
  });

  test("the hide resolved choice stays for the host across views", () => {
    const storage = createMemoryClientStorage();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        ClientConnectionProvider,
        { connection: createTestClientConnection({ storage }) },
        children,
      );
    const first = renderHook(useHideResolvedComments, { wrapper });
    act(() => first.result.current.setHideResolved(true));
    first.unmount();
    const second = renderHook(useHideResolvedComments, { wrapper });
    expect(second.result.current.hideResolved).toBe(true);
    second.unmount();
  });
});

describe("check groups", () => {
  const check = (
    name: string,
    status: PullRequestReviewCheck["status"],
    conclusion: PullRequestReviewCheck["conclusion"],
  ): PullRequestReviewCheck => ({
    name,
    workflow: "CI",
    status,
    conclusion,
    url: null,
    details: null,
    startedAt: null,
    completedAt: null,
  });

  test("lists failed checks first, then running, other, passed, and skipped checks", () => {
    const items = buildChecksListItems(
      {
        ...loaded,
        checks: [
          check("docs", "completed", "skipped"),
          check("unit", "completed", "success"),
          check("e2e", "in_progress", null),
          check("lint", "completed", "timed_out"),
          check("label", "completed", "neutral"),
          check("test", "completed", "failure"),
        ],
      },
      "all",
      false,
    );
    expect(
      items.flatMap((item) => (item.kind === "check" ? [`${item.group} ${item.check.name}`] : [])),
    ).toEqual([
      "failed lint",
      "failed test",
      "pending e2e",
      "neutral label",
      "passed unit",
      "skipped docs",
    ]);
  });

  test("a check keeps its key when the provider adds a check before it", () => {
    const keyOf = (checks: PullRequestReviewCheck[], name: string) =>
      buildChecksListItems({ ...loaded, checks }, "all", false).find(
        (item) => item.kind === "check" && item.check.name === name,
      )?.key;
    const lint = check("lint", "completed", "failure");
    const before = keyOf([lint], "lint");
    expect(keyOf([check("rerun", "completed", "failure"), lint], "lint")).toBe(before);
    // Two checks with one workflow and name keep two keys.
    const keys = buildChecksListItems({ ...loaded, checks: [lint, { ...lint }] }, "all", false)
      .filter((item) => item.kind === "check")
      .map((item) => item.key);
    expect(new Set(keys).size).toBe(2);
  });

  test("shows the Checks header and a note when the provider reports no checks", () => {
    const items = buildChecksListItems({ ...loaded, checks: [] }, "all", false);
    expect(items.slice(0, 2)).toEqual([
      {
        kind: "checks_header",
        key: "checks_header",
        aggregateStatus: "failure",
        summary: "No checks",
        count: 0,
        open: true,
      },
      { kind: "no_checks", key: "no_checks" },
    ]);
  });

  test("a closed section keeps only its header", () => {
    const kinds = (sections: { checks: boolean; comments: boolean }) =>
      buildChecksListItems(loaded, "all", false, sections).map((item) => item.kind);
    expect(kinds({ checks: false, comments: true })).toEqual([
      "checks_header",
      "comments_header",
      "comment",
      "comment",
      "comment",
    ]);
    expect(kinds({ checks: true, comments: false })).toEqual([
      "checks_header",
      "check",
      "comments_header",
    ]);
  });

  test("lists the details of an opened check with its run time", () => {
    const now = Date.parse("2026-10-01T12:10:00Z");
    const details = checkDetails(
      {
        ...check("test", "completed", "success"),
        details: "All tests passed",
        startedAt: "2026-10-01T12:00:00Z",
        completedAt: "2026-10-01T12:02:14Z",
      },
      now,
    );
    expect(details.map((detail) => detail.label)).toEqual([
      "Workflow",
      "Details",
      "Started",
      "Completed",
      "Duration",
    ]);
    expect(details.at(-1)?.value).toBe("2m 14s");
    expect(checkDetails({ ...check("lint", "queued", null), workflow: null }, now)).toEqual([]);
  });

  test("shows the run time of a completed check and the start of a running check", () => {
    const now = Date.parse("2026-10-01T12:10:00Z");
    expect(
      checkTimeLabel(
        {
          ...check("test", "completed", "success"),
          startedAt: "2026-10-01T12:00:00Z",
          completedAt: "2026-10-01T12:02:14Z",
        },
        now,
      ),
    ).toBe("2m 14s");
    expect(
      checkTimeLabel(
        { ...check("e2e", "in_progress", null), startedAt: "2026-10-01T12:07:00Z" },
        now,
      ),
    ).toBe("Started 3m ago");
    expect(checkTimeLabel(check("lint", "queued", null), now)).toBeNull();
    expect(formatCheckDuration(45_000)).toBe("45s");
    expect(formatCheckDuration(120_000)).toBe("2m");
    expect(formatCheckDuration(3_900_000)).toBe("1h 5m");
  });
});

describe("unknown outcomes", () => {
  test("reads the host guidance of a lost command result only", () => {
    const lost = new RemoteConnectionError({
      code: "outcome_unknown",
      message: "The host did not confirm the command.",
      nextAction: "Check the host state before you try again.",
    });
    expect(unknownOutcomeGuidance(lost)).toBe("Check the host state before you try again.");
    expect(unknownOutcomeGuidance(new Error("Failed."))).toBeNull();
  });
});
