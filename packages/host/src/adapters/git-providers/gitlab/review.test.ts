import { describe, expect, test } from "bun:test";
import type {
  PullRequest,
  PullRequestReviewActivity,
  PullRequestReviewContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import { HostValidationError } from "../../../effect/host-errors";
import type {
  gitlabJobSchema,
  gitlabMergeRequestDetailSchema,
  gitlabNoteSchema,
  gitlabPositionSchema,
} from "./models";
import { createGitlabReviewPort } from "./review";
import {
  apiRequests,
  createFakeGitlab,
  type FakeGitlabResponse,
  gitlabTestRepoConfig as repoConfig,
  PROJECT_ID,
  PROJECT_IDENTITY,
  PROJECT_WEB_URL,
} from "./test-support";

const P = `/projects/${PROJECT_ID}`;
const MR = `${P}/merge_requests/5`;
const MR_URL = `${PROJECT_WEB_URL}/-/merge_requests/5`;

type MergeRequestFields = Partial<z.input<typeof gitlabMergeRequestDetailSchema>>;
type JobFields = Partial<z.input<typeof gitlabJobSchema>>;
type NoteFields = Partial<z.input<typeof gitlabNoteSchema>>;
type PositionFields = z.input<typeof gitlabPositionSchema>;

const linkedPullRequest: PullRequest = {
  providerId: "gitlab",
  repositoryIdentity: PROJECT_IDENTITY,
  number: 5,
  url: MR_URL,
  state: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const mergeRequest = (overrides: MergeRequestFields = {}) => ({
  iid: 5,
  title: "Add GitLab",
  description: "",
  state: "opened",
  draft: false,
  source_branch: "odt/task-42",
  target_branch: "main",
  source_project_id: PROJECT_ID,
  target_project_id: PROJECT_ID,
  web_url: MR_URL,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  sha: "headsha",
  head_pipeline: { id: 100 },
  ...overrides,
});

const job = (id: number, name: string, status: string, overrides: JobFields = {}) => ({
  id,
  name,
  stage: "test",
  status,
  allow_failure: false,
  started_at: "2026-01-02T10:00:00.000Z",
  finished_at: "2026-01-02T10:05:00.000Z",
  web_url: `${PROJECT_WEB_URL}/-/jobs/${id}`,
  ...overrides,
});

const user = (id: number, username: string) => ({
  id,
  username,
  avatar_url: `https://gitlab.example.com/uploads/avatar/${id}.png`,
});

const note = (id: number, body: string, overrides: NoteFields = {}) => ({
  id,
  type: null,
  body,
  author: user(id, `user${id}`),
  created_at: "2026-01-03T00:00:00.000Z",
  updated_at: "2026-01-03T00:00:00.000Z",
  system: false,
  ...overrides,
});

const position = (overrides: PositionFields): PositionFields => ({
  base_sha: "b1",
  start_sha: "s1",
  head_sha: "h1",
  old_line: null,
  new_line: null,
  ...overrides,
});

const diffNote = (
  id: number,
  body: string,
  notePosition: PositionFields,
  overrides: NoteFields = {},
) =>
  note(id, body, {
    type: "DiffNote",
    resolvable: true,
    resolved: false,
    position: notePosition,
    ...overrides,
  });

const readContext = async (routes: Record<string, FakeGitlabResponse>) => {
  const fake = createFakeGitlab({
    [`GET ${MR}`]: { json: mergeRequest() },
    [`GET ${MR}/discussions`]: { json: [] },
    [`GET ${MR}/approvals`]: { json: { approved_by: [] } },
    [`GET ${MR}/reviewers`]: { json: [] },
    [`GET ${P}/pipelines/100/jobs`]: { json: [] },
    [`GET ${P}/pipelines/100/bridges`]: { json: [] },
    [`GET ${P}/repository/commits/headsha/statuses`]: { json: [] },
    "GET /users/*": { json: { id: 1, bot: false } },
    ...routes,
  });
  const context = await Effect.runPromise(
    createGitlabReviewPort({ client: fake.client }).readContext({ repoConfig, linkedPullRequest }),
  );
  if (context.status !== "loaded") throw new Error(`Expected a loaded context: ${context.status}`);
  return { context, requests: fake.requests };
};

type LoadedContext = Extract<PullRequestReviewContext, { status: "loaded" }>;

const commentById = (context: LoadedContext, id: string): PullRequestReviewActivity => {
  const comment = context.comments.find((activity) => activity.id === id);
  if (!comment) throw new Error(`Missing activity ${id}`);
  return comment;
};

describe("GitLab review adapter", () => {
  test("loads the merge request and maps pipeline jobs, trigger jobs, and external statuses", async () => {
    const { context } = await readContext({
      [`GET ${P}/pipelines/100/jobs`]: {
        json: [
          job(1, "build", "success", { stage: "build" }),
          job(2, "lint", "failed", { allow_failure: true }),
          job(3, "deploy", "manual", { stage: "deploy", started_at: null, finished_at: null }),
          job(4, "e2e", "running", { finished_at: null }),
        ],
      },
      [`GET ${P}/pipelines/100/bridges`]: {
        json: [job(5, "downstream", "pending", { stage: "trigger", started_at: null })],
      },
      [`GET ${P}/repository/commits/headsha/statuses`]: {
        json: [
          { id: 1, name: "build", status: "success", allow_failure: false },
          {
            id: 50,
            name: "sonar",
            status: "success",
            target_url: "https://sonar.example.com/run/1",
            description: "Quality gate passed",
            created_at: "2026-01-02T09:00:00.000Z",
            started_at: null,
            finished_at: "2026-01-02T09:30:00.000Z",
            allow_failure: false,
          },
        ],
      },
    });

    expect(context.pullRequest).toEqual({
      providerId: "gitlab",
      number: 5,
      title: "Add GitLab",
      url: MR_URL,
      state: "open",
    });
    expect(context.checks).toEqual([
      {
        name: "build",
        workflow: "build",
        status: "completed",
        conclusion: "success",
        url: `${PROJECT_WEB_URL}/-/jobs/1`,
        details: "GitLab job status: success",
        startedAt: "2026-01-02T10:00:00.000Z",
        completedAt: "2026-01-02T10:05:00.000Z",
      },
      expect.objectContaining({
        name: "lint",
        conclusion: "warning",
        details: "GitLab job status: failed; allowed to fail",
      }),
      expect.objectContaining({
        name: "deploy",
        workflow: "deploy",
        status: "completed",
        conclusion: "action_required",
        completedAt: null,
      }),
      expect.objectContaining({
        name: "e2e",
        status: "in_progress",
        conclusion: null,
        completedAt: null,
      }),
      expect.objectContaining({
        name: "downstream",
        workflow: "trigger",
        status: "queued",
        details: "GitLab trigger job status: pending",
      }),
      {
        name: "sonar",
        workflow: "External",
        status: "completed",
        conclusion: "success",
        url: "https://sonar.example.com/run/1",
        details: "Quality gate passed",
        startedAt: "2026-01-02T09:00:00.000Z",
        completedAt: "2026-01-02T09:30:00.000Z",
      },
    ]);
    expect(context.aggregateStatus).toBe("failure");
  });

  test("marks a service account with a custom username as a bot from its user record", async () => {
    const { context, requests } = await readContext({
      [`GET ${MR}/discussions`]: {
        json: [
          {
            id: "d1",
            individual_note: true,
            notes: [
              {
                id: 1,
                type: null,
                body: "Build passed",
                author: user(77, "build-assistant"),
                created_at: null,
                updated_at: null,
                system: false,
              },
              {
                id: 2,
                type: null,
                body: "Thanks",
                author: user(77, "build-assistant"),
                created_at: null,
                updated_at: null,
                system: false,
              },
            ],
          },
        ],
      },
      "GET /users/77": { json: { id: 77, bot: true } },
    });

    expect(context.comments.map((comment) => comment.authorIsBot)).toEqual([true, true]);
    expect(requests.filter((request) => request.path === "/users/77")).toHaveLength(1);
  });

  test("reads only external statuses, so another pipeline's native jobs stay out", async () => {
    const { context, requests } = await readContext({
      [`GET ${P}/pipelines/100/jobs`]: { json: [job(1, "test", "success")] },
    });

    const statusRead = requests.find((request) =>
      request.path.endsWith("/repository/commits/headsha/statuses"),
    );
    expect(statusRead?.query.get("stage")).toBe("external");
    expect(context.aggregateStatus).toBe("success");
  });

  test.each([
    { name: "no checks", jobs: [], aggregate: "unknown" },
    {
      name: "a running job",
      jobs: [job(1, "a", "success"), job(2, "b", "running")],
      aggregate: "pending",
    },
    {
      name: "success with an allowed failure, a skipped job, and an optional manual job",
      jobs: [
        job(1, "a", "success"),
        job(2, "b", "failed", { allow_failure: true }),
        job(3, "c", "skipped"),
        job(4, "d", "manual", { allow_failure: true }),
      ],
      aggregate: "success",
    },
    { name: "a cancelled job", jobs: [job(1, "a", "canceled")], aggregate: "failure" },
    { name: "an unknown job status", jobs: [job(1, "a", "mystery")], aggregate: "unknown" },
  ])("reports $aggregate for $name", async ({ jobs, aggregate }) => {
    const { context } = await readContext({ [`GET ${P}/pipelines/100/jobs`]: { json: jobs } });

    expect(context.aggregateStatus).toBe(aggregate);
  });

  test("reads no pipeline when the merge request has none", async () => {
    const { context, requests } = await readContext({
      [`GET ${MR}`]: { json: mergeRequest({ head_pipeline: null, sha: null }) },
    });

    expect(context.checks).toEqual([]);
    expect(apiRequests(requests).filter((request) => request.includes("pipelines"))).toEqual([]);
  });

  test("maps comments and diff threads and reads each version diff once", async () => {
    const aPosition = position({ old_path: "src/a.ts", new_path: "src/a.ts", new_line: 12 });
    const bPosition = position({ old_path: "src/b.ts", new_path: "src/b.ts", old_line: 3 });
    const { context, requests } = await readContext({
      [`GET ${MR}/discussions`]: {
        json: [
          {
            id: "sys",
            individual_note: true,
            notes: [note(1, "added 1 commit", { system: true })],
          },
          { id: "single", individual_note: true, notes: [note(10, "Looks fine")] },
          {
            id: "thread-a",
            individual_note: false,
            notes: [diffNote(20, "Rename this", aPosition), diffNote(21, "Done", aPosition)],
          },
          {
            id: "thread-b",
            individual_note: false,
            notes: [diffNote(30, "Why remove c?", bPosition, { resolved: true })],
          },
          {
            id: "thread-c",
            individual_note: false,
            notes: [
              note(40, "Open question", {
                type: "DiscussionNote",
                resolvable: true,
                resolved: false,
              }),
            ],
          },
        ],
      },
      [`GET ${MR}/versions`]: {
        json: [
          { id: 299, head_commit_sha: "old", base_commit_sha: "b1", start_commit_sha: "s1" },
          { id: 300, head_commit_sha: "h1", base_commit_sha: "b1", start_commit_sha: "s1" },
        ],
      },
      [`GET ${MR}/versions/300`]: {
        json: {
          diffs: [
            {
              old_path: "src/a.ts",
              new_path: "src/a.ts",
              diff: "@@ -8,6 +8,7 @@ function x() {\n line8\n line9\n line10\n-old11\n+new11\n+new12\n line13\n",
            },
            {
              old_path: "src/b.ts",
              new_path: "src/b.ts",
              diff: "@@ -1,4 +1,3 @@\n a\n b\n-c\n d\n",
            },
          ],
        },
      },
    });

    expect(context.comments.map((comment) => comment.id)).toEqual(["10", "20", "21", "30", "40"]);
    expect(commentById(context, "10")).toEqual({
      id: "10",
      source: "comment",
      author: "user10",
      authorIsBot: false,
      authorAvatarUrl: "https://gitlab.example.com/uploads/avatar/10.png",
      body: "Looks fine",
      patch: null,
      suggestionPatches: [],
      suggestionWarning: null,
      url: `${MR_URL}#note_10`,
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      path: null,
      line: null,
      threadId: null,
      isResolved: null,
    });
    expect(commentById(context, "21")).toMatchObject({
      source: "review_thread",
      body: "Done",
      path: "src/a.ts",
      line: 12,
      threadId: "thread-a",
      isResolved: false,
      patch: "@@ -10,2 +10,3 @@\n line10\n-old11\n+new11\n+new12",
    });
    expect(commentById(context, "30")).toMatchObject({
      source: "review_thread",
      path: "src/b.ts",
      line: 3,
      isResolved: true,
      patch: "@@ -1,3 +1,2 @@\n a\n b\n-c",
    });
    expect(commentById(context, "40")).toMatchObject({
      source: "comment",
      threadId: "thread-c",
      isResolved: false,
    });
    expect(context.reviewThreads.openCount).toBe(2);
    expect(apiRequests(requests).filter((request) => request.includes("/versions"))).toEqual([
      `GET ${MR}/versions`,
      `GET ${MR}/versions/300`,
    ]);
  });

  test("reads a suggestion in a longer fence that holds a code block", async () => {
    const cPosition = position({ old_path: "src/c.ts", new_path: "src/c.ts", new_line: 2 });
    const suggestion = "Try:\n````suggestion:-0+0\n```ts\nconst b = 2;\n```\n````";
    const { context } = await readContext({
      [`GET ${MR}/discussions`]: {
        json: [{ id: "t1", individual_note: false, notes: [diffNote(1, suggestion, cPosition)] }],
      },
      [`GET ${MR}/versions`]: { json: [] },
      [`GET ${P}/repository/files/src%2Fc.ts/raw`]: {
        bytes: new TextEncoder().encode("line1\nline2\nline3\n"),
      },
    });

    expect(commentById(context, "1")).toMatchObject({
      body: "Try:",
      suggestionPatches: ["@@ -2,1 +2,3 @@\n-line2\n+```ts\n+const b = 2;\n+```"],
      suggestionWarning: null,
    });
  });

  test("turns suggestions into patches and reads each suggested file once", async () => {
    const cPosition = position({ old_path: "src/c.ts", new_path: "src/c.ts", new_line: 2 });
    const missingPosition = position({ old_path: "src/x.ts", new_path: "src/x.ts", new_line: 1 });
    const suggestion = "Use this:\n```suggestion:-1+0\nconst a = 2;\nconst b = 3;\n```";
    const missingSuggestion = "Try:\n```suggestion\nnew\n```";
    const { context, requests } = await readContext({
      [`GET ${MR}/discussions`]: {
        json: [
          { id: "t1", individual_note: false, notes: [diffNote(1, suggestion, cPosition)] },
          {
            id: "t2",
            individual_note: false,
            notes: [diffNote(2, "```suggestion\nline two\n```", cPosition)],
          },
          {
            id: "t3",
            individual_note: false,
            notes: [diffNote(3, missingSuggestion, missingPosition)],
          },
          {
            id: "t4",
            individual_note: false,
            notes: [diffNote(4, "```suggestion:-0+5\nx\n```", cPosition)],
          },
        ],
      },
      [`GET ${MR}/versions`]: { json: [] },
      [`GET ${P}/repository/files/src%2Fc.ts/raw`]: {
        bytes: new TextEncoder().encode("line1\nline2\nline3\n"),
      },
    });

    expect(commentById(context, "1")).toMatchObject({
      body: "Use this:",
      suggestionPatches: ["@@ -1,2 +1,2 @@\n-line1\n-line2\n+const a = 2;\n+const b = 3;"],
      suggestionWarning: null,
    });
    expect(commentById(context, "2")).toMatchObject({
      body: "",
      suggestionPatches: ["@@ -2,1 +2,1 @@\n-line2\n+line two"],
    });
    expect(commentById(context, "3")).toMatchObject({
      body: missingSuggestion,
      suggestionPatches: [],
    });
    expect(commentById(context, "3").suggestionWarning).toContain(
      "GitLab suggestion source could not be loaded",
    );
    expect(commentById(context, "4")).toMatchObject({
      body: "```suggestion:-0+5\nx\n```",
      suggestionPatches: [],
      suggestionWarning: expect.stringContaining("could not be located"),
    });
    expect(
      requests
        .filter((request) => request.path.includes("/repository/files/"))
        .map((request) => `${request.path}?ref=${request.query.get("ref")}`),
    ).toEqual([
      `${P}/repository/files/src%2Fc.ts/raw?ref=h1`,
      `${P}/repository/files/src%2Fx.ts/raw?ref=h1`,
    ]);
  });

  test("shows current approvals and reviews, but not a withdrawn approval", async () => {
    const { context } = await readContext({
      [`GET ${MR}/approvals`]: {
        json: { approved_by: [{ user: user(1, "ann"), approved_at: "2026-01-04T00:00:00.000Z" }] },
      },
      [`GET ${MR}/reviewers`]: {
        json: [
          { user: user(1, "ann"), state: "approved" },
          { user: user(2, "bob"), state: "requested_changes" },
          { user: user(3, "cat"), state: "reviewed" },
          { user: user(4, "dan"), state: "unapproved" },
          { user: user(5, "eve"), state: "unreviewed" },
        ],
      },
    });

    expect(
      context.comments.map((comment) => [comment.author, comment.source, comment.reviewOutcome]),
    ).toEqual([
      ["ann", "review", "approved"],
      ["bob", "review", "changes_requested"],
      ["cat", "review", "commented"],
    ]);
    expect(context.comments[0]).toMatchObject({
      body: "",
      url: MR_URL,
      createdAt: "2026-01-04T00:00:00.000Z",
      path: null,
      line: null,
      threadId: null,
      isResolved: null,
    });
  });

  test("rejects a merge request of another project before it reads it", async () => {
    const fake = createFakeGitlab({});

    const failure = await Effect.runPromise(
      createGitlabReviewPort({ client: fake.client })
        .readContext({
          repoConfig,
          linkedPullRequest: {
            ...linkedPullRequest,
            repositoryIdentity: "gitlab::https://gitlab.example.com::1",
          },
        })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "pullRequest.repositoryIdentity" });
    expect(apiRequests(fake.requests)).toEqual([]);
  });

  test("reports a GitLab request failure as a validation error", async () => {
    const fake = createFakeGitlab({ [`GET ${MR}`]: { status: 500, json: { message: "boom" } } });

    const failure = await Effect.runPromise(
      createGitlabReviewPort({ client: fake.client })
        .readContext({ repoConfig, linkedPullRequest })
        .pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure.message).toStartWith("Failed to load GitLab review context: ");
    expect(failure.message).toContain("HTTP 500: boom");
  });
});
