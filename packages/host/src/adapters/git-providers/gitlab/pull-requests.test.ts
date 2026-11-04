import { describe, expect, test } from "bun:test";
import type { GitlabRepository, PullRequest, TaskApprovalContext } from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import { HostValidationError } from "../../../effect/host-errors";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import type { gitlabMergeRequestSchema } from "./models";
import { createGitlabPullRequestPort } from "./pull-requests";
import {
  apiRequests,
  createFakeGitlab,
  type FakeGitlabResponse,
  gitlabTestRepoConfig as repoConfig,
  gitlabTestRepository,
  PROJECT_ID,
  PROJECT_IDENTITY,
  PROJECT_WEB_URL,
} from "./test-support";

const repositoryPort: GitProviderRepositoryPort<GitlabRepository> = {
  detectRepository: () => Effect.die(new Error("unexpected detection")),
  getRepository: () => Effect.succeed(gitlabTestRepository),
  getMapping: () => Effect.succeed({ repository: gitlabTestRepository, remoteName: "upstream" }),
};

const MR_PATH = `/projects/${PROJECT_ID}/merge_requests`;

const mergeRequest = (
  iid: number,
  overrides: Partial<z.input<typeof gitlabMergeRequestSchema>> = {},
) => ({
  iid,
  title: `Merge request ${iid}`,
  description: "",
  state: "opened",
  draft: false,
  source_branch: "odt/task-42",
  target_branch: "main",
  source_project_id: PROJECT_ID,
  target_project_id: PROJECT_ID,
  web_url: `${PROJECT_WEB_URL}/-/merge_requests/${iid}`,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  merged_at: null,
  closed_at: null,
  ...overrides,
});

const approval: TaskApprovalContext = {
  taskId: "task-42",
  taskStatus: "human_review",
  workingDirectory: "/worktrees/repo/task-42",
  sourceBranch: "odt/task-42",
  targetBranch: { remote: "origin", branch: "main" },
  defaultMergeMethod: "merge_commit",
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
};

const linked = (number: number, overrides: Partial<PullRequest> = {}): PullRequest => ({
  providerId: "gitlab",
  repositoryIdentity: PROJECT_IDENTITY,
  number,
  url: `${PROJECT_WEB_URL}/-/merge_requests/${number}`,
  state: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const portFor = (routes: Record<string, FakeGitlabResponse>) => {
  const fake = createFakeGitlab(routes);
  return { ...fake, port: createGitlabPullRequestPort({ client: fake.client, repositoryPort }) };
};

describe("GitLab pull request adapter", () => {
  test("finds the open merge request of a branch and ignores merge requests from forks", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}`]: {
        json: [mergeRequest(5, { draft: true }), mergeRequest(6, { source_project_id: 99 })],
      },
    });

    const found = await Effect.runPromise(
      port.findOpenForSourceBranch({ repoConfig, sourceBranch: "odt/task-42" }),
    );

    expect(found).toMatchObject({
      sourceBranch: "odt/task-42",
      targetBranch: "main",
      record: {
        providerId: "gitlab",
        repositoryIdentity: PROJECT_IDENTITY,
        number: 5,
        url: `${PROJECT_WEB_URL}/-/merge_requests/5`,
        state: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });
    expect(found?.record.lastSyncedAt).toBeString();
    const listRequest = requests.find((request) => request.path === MR_PATH);
    expect(listRequest?.query.get("source_branch")).toBe("odt/task-42");
    expect(listRequest?.query.get("state")).toBe("opened");
  });

  test("asks the user to keep one open merge request when a branch has several", async () => {
    const { port } = portFor({
      [`GET ${MR_PATH}`]: { json: [mergeRequest(5), mergeRequest(6)] },
    });

    const failure = await Effect.runPromise(
      port.findOpenForSourceBranch({ repoConfig, sourceBranch: "odt/task-42" }).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure.message).toContain("#5, #6");
    expect(failure.message).toContain("only one open pull request");
  });

  test("returns the merge request merged last for a branch", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}`]: {
        json: [
          mergeRequest(3, { state: "merged", merged_at: "2026-02-03T00:00:00.000Z" }),
          mergeRequest(4, { state: "merged", merged_at: "2026-02-01T00:00:00.000Z" }),
        ],
      },
    });

    const merged = await Effect.runPromise(
      port.findLatestMergedForSourceBranch({ repoConfig, sourceBranch: "odt/task-42" }),
    );

    expect(merged?.record).toMatchObject({
      number: 3,
      state: "merged",
      mergedAt: "2026-02-03T00:00:00.000Z",
    });
    expect(requests.find((request) => request.path === MR_PATH)?.query.get("state")).toBe("merged");
  });

  test("maps closed and locked merge requests", async () => {
    const { port } = portFor({
      [`GET ${MR_PATH}/7`]: {
        json: mergeRequest(7, { state: "closed", closed_at: "2026-03-01T00:00:00.000Z" }),
      },
      [`GET ${MR_PATH}/8`]: { json: mergeRequest(8, { state: "locked" }) },
    });

    const closed = await Effect.runPromise(port.getByNumber({ repoConfig, number: 7 }));
    const locked = await Effect.runPromise(port.getByNumber({ repoConfig, number: 8 }));

    expect(closed.record).toMatchObject({
      state: "closed_unmerged",
      closedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(closed.record.mergedAt).toBeUndefined();
    expect(locked.record.state).toBe("open");
  });

  test("refreshes a linked merge request of the configured project", async () => {
    const { port } = portFor({
      [`GET ${MR_PATH}/9`]: {
        json: mergeRequest(9, { state: "merged", merged_at: "2026-03-02T00:00:00.000Z" }),
      },
    });

    const refreshed = await Effect.runPromise(
      port.refresh({ repoConfig, linkedPullRequest: linked(9) }),
    );

    expect(refreshed.record).toMatchObject({ number: 9, state: "merged" });
  });

  test("rejects a link of another provider before it sends a request", async () => {
    const { port, requests } = portFor({});

    const failure = await Effect.runPromise(
      port
        .refresh({ repoConfig, linkedPullRequest: linked(9, { providerId: "github" }) })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "pullRequest.providerId" });
    expect(requests).toEqual([]);
  });

  test("does not read a merge request of another project with the same number", async () => {
    const { port, requests } = portFor({});

    const failure = await Effect.runPromise(
      port
        .refresh({
          repoConfig,
          linkedPullRequest: linked(9, {
            repositoryIdentity: "gitlab::https://gitlab.example.com::1",
          }),
        })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "pullRequest.repositoryIdentity" });
    expect(failure.message).toContain("another project");
    expect(apiRequests(requests)).toEqual([]);
  });

  test("creates a merge request with only the branches, the title, and the description", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}`]: { json: [] },
      [`POST ${MR_PATH}`]: { status: 201, json: mergeRequest(11, { title: "Add GitLab" }) },
    });

    const created = await Effect.runPromise(
      port.upsert({ repoConfig, approval, title: "  Add GitLab  ", body: "Body text" }),
    );

    expect(created).toMatchObject({ providerId: "gitlab", number: 11, state: "open" });
    expect(requests.find((request) => request.method === "POST")?.json).toEqual({
      source_branch: "odt/task-42",
      target_branch: "main",
      title: "Add GitLab",
      description: "Body text",
    });
  });

  test("updates the open merge request of the task branch", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}`]: { json: [mergeRequest(12)] },
      [`PUT ${MR_PATH}/12`]: { json: mergeRequest(12, { title: "New title" }) },
    });

    const updated = await Effect.runPromise(
      port.upsert({ repoConfig, approval, title: " New title ", body: "New body" }),
    );

    expect(updated.number).toBe(12);
    expect(apiRequests(requests)).toEqual([`GET ${MR_PATH}`, `PUT ${MR_PATH}/12`]);
    expect(requests.at(-1)?.json).toEqual({ title: "New title", description: "New body" });
  });

  test("keeps the draft state when it updates a draft merge request", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}`]: { json: [mergeRequest(12, { draft: true })] },
      [`PUT ${MR_PATH}/12`]: { json: mergeRequest(12, { draft: true }) },
    });

    await Effect.runPromise(port.upsert({ repoConfig, approval, title: "New title", body: "" }));

    expect(requests.at(-1)?.json).toEqual({ title: "Draft: New title", description: "" });
  });

  test("adds no second draft prefix to a draft title", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}`]: { json: [mergeRequest(12, { draft: true })] },
      [`PUT ${MR_PATH}/12`]: { json: mergeRequest(12, { draft: true }) },
    });

    await Effect.runPromise(port.upsert({ repoConfig, approval, title: "[Draft] New", body: "" }));

    expect(requests.at(-1)?.json).toEqual({ title: "[Draft] New", description: "" });
  });

  test("reads the project once for several pull request reads", async () => {
    const { port, requests } = portFor({ [`GET ${MR_PATH}/7`]: { json: mergeRequest(7) } });

    await Effect.runPromise(port.getByNumber({ repoConfig, number: 7 }));
    await Effect.runPromise(port.getByNumber({ repoConfig, number: 7 }));

    expect(requests.filter((request) => !request.path.includes("/merge_requests"))).toHaveLength(1);
  });

  test("rejects a fork merge request linked by number", async () => {
    const { port } = portFor({
      [`GET ${MR_PATH}/14`]: { json: mergeRequest(14, { source_project_id: 999 }) },
    });

    const failure = await Effect.runPromise(
      port.getByNumber({ repoConfig, number: 14 }).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure.message).toContain("from another project, such as a fork");
  });

  test("asks to keep one open merge request when a linked one shares its branch", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}/1`]: { json: mergeRequest(1) },
      [`GET ${MR_PATH}`]: {
        json: [mergeRequest(1), mergeRequest(2, { target_branch: "release" })],
      },
    });

    const failure = await Effect.runPromise(
      port
        .upsert({
          repoConfig,
          approval: { ...approval, pullRequest: linked(1) },
          title: "Title",
          body: "",
        })
        .pipe(Effect.flip),
    );

    expect(failure.message).toContain("only one open pull request");
    expect(apiRequests(requests)).not.toContain(`PUT ${MR_PATH}/1`);
  });

  test("refuses to update a linked merge request that is merged", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}/13`]: { json: mergeRequest(13, { state: "merged" }) },
    });

    const failure = await Effect.runPromise(
      port
        .upsert({
          repoConfig,
          approval: { ...approval, pullRequest: linked(13) },
          title: "Title",
          body: "",
        })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "pullRequest.state" });
    expect(failure.message).toContain("#13 is merged");
    expect(apiRequests(requests)).toEqual([`GET ${MR_PATH}/13`]);
  });

  test("refuses to update a merge request that targets another branch", async () => {
    const { port, requests } = portFor({
      [`GET ${MR_PATH}`]: { json: [mergeRequest(14, { target_branch: "release" })] },
    });

    const failure = await Effect.runPromise(
      port.upsert({ repoConfig, approval, title: "Title", body: "" }).pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "targetBranch" });
    expect(failure.message).toContain("targets release, not main");
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  test("publishes to the mapped remote", async () => {
    const { port } = portFor({});

    expect(await Effect.runPromise(port.resolvePublishRemote({ repoConfig }))).toBe("upstream");
  });
});
