import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitHistoryPage, GitHistoryPageRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { GIT_HISTORY_PAGE_SIZE } from "../../infrastructure/git/git-history";
import { createGitService } from "./git-service";

// These tests start real Git processes, because the commit graph belongs to Git.
// Real Git processes start slowly on Windows runners, so each test gets more time.
const GIT_TEST_TIMEOUT_MS = 30_000;
const service = createGitService(
  createGitCliAdapter({ resolveCommand: () => Effect.succeed("git") }),
);

let repo = "";
const git = (args: string[], input?: string) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const commit = async (file: string, message: string) => {
  await writeFile(path.join(repo, file), `${message}\n`);
  git(["add", file]);
  git(["commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
};

/** A commit with its own author and commit times, so a test can tell the two orders apart. */
const commitAt = async (file: string, message: string, authorDate: string, commitDate: string) => {
  await writeFile(path.join(repo, file), `${message}\n`);
  git(["add", file]);
  execFileSync("git", ["commit", "-m", message], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: commitDate },
    stdio: "ignore",
  });
  return git(["rev-parse", "HEAD"]);
};

const history = async (
  targetReference: string,
  page?: GitHistoryPageRequest["page"],
): Promise<GitHistoryPage> => {
  const expectedBranch = await Effect.runPromise(service.getCurrentBranch({ repoPath: repo }));
  const request: GitHistoryPageRequest = { repoPath: repo, targetReference, expectedBranch };
  if (page) request.page = page;
  return Effect.runPromise(service.getHistoryPage(request));
};

const requirePage = (page: GitHistoryPage) => {
  if (page.outcome !== "page") throw new Error(`Expected a page, got ${page.outcome}.`);
  return page;
};

const failure = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the History read to fail.");
};

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "git-history-"));
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "History Test"]);
  git(["config", "user.email", "history@example.invalid"]);
  git(["config", "commit.gpgsign", "false"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("branch history", () => {
  test(
    "shows both sides, merge parents, and the shared boundary",
    async () => {
      const older = await commit("base.txt", "older shared");
      const base = await commit("base.txt", "shared base");
      git(["checkout", "-b", "feature"]);
      const featureA = await commit("a.txt", "feature a");
      git(["checkout", "main"]);
      const mainM = await commit("m.txt", "main m");
      git(["checkout", "feature"]);
      git(["merge", "--no-edit", "main"]);
      const merge = git(["rev-parse", "HEAD"]);
      const featureB = await commit("b.txt", "feature b\n\nLonger body line.");
      git(["checkout", "main"]);
      const mainN = await commit("n.txt", "main n");
      git(["checkout", "feature"]);

      const page = requirePage(await history("refs/heads/main"));

      expect(page.comparison).toEqual({
        currentTip: featureB,
        targetTip: mainN,
        boundaryOids: [mainM],
        aheadBehind: { ahead: 3, behind: 1 },
      });
      expect(page.nextOffset).toBeNull();
      const byOid = new Map(page.commits.map((entry) => [entry.oid, entry]));
      expect([...byOid.keys()].sort()).toEqual([featureA, merge, featureB, mainN, mainM].sort());
      expect(byOid.get(merge)?.parentOids).toEqual([featureA, mainM]);
      expect(byOid.get(featureA)?.parentOids).toEqual([base]);
      expect(byOid.get(featureA)?.outsideParentOids).toEqual([base]);
      expect(byOid.get(merge)?.outsideParentOids).toEqual([]);
      expect(byOid.get(mainM)?.membership).toBe("boundary");
      expect(byOid.get(mainN)?.membership).toBe("target");
      expect(byOid.get(featureB)).toMatchObject({
        membership: "current",
        subject: "feature b",
        message: "feature b\n\nLonger body line.",
        authorName: "History Test",
      });
      // Git writes `Z` for a UTC offset, as on CI runners.
      expect(byOid.get(featureB)?.authorDate).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u,
      );
      expect(byOid.has(older)).toBe(false);
      // Children come before their parents.
      const order = page.commits.map((entry) => entry.oid);
      expect(order.indexOf(merge)).toBeLessThan(order.indexOf(featureA));
      expect(order.indexOf(mainN)).toBeLessThan(order.indexOf(mainM));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "sorts the commits of both branches by author date, newest first",
    async () => {
      const base = await commitAt(
        "base.txt",
        "base",
        "2026-01-01T10:00:00Z",
        "2026-01-01T10:00:00Z",
      );
      git(["checkout", "-b", "feature"]);
      const f1 = await commitAt("f.txt", "f1", "2026-01-02T10:00:00Z", "2026-01-02T10:00:00Z");
      const f2 = await commitAt("f.txt", "f2", "2026-01-04T10:00:00Z", "2026-01-03T10:00:00Z");
      git(["checkout", "main"]);
      const m1 = await commitAt("m.txt", "m1", "2026-01-03T10:00:00Z", "2026-01-04T10:00:00Z");
      const m2 = await commitAt("m.txt", "m2", "2026-01-05T10:00:00Z", "2026-01-05T10:00:00Z");
      git(["checkout", "feature"]);

      const page = requirePage(await history("refs/heads/main"));

      // The branches mix by the date that each row shows, and every parent stays below its child.
      expect(page.commits.map((entry) => entry.oid)).toEqual([m2, f2, m1, f1, base]);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "follows a rebase that stops on a conflict, as a Git tree does",
    async () => {
      const base = await commit("a.txt", "base");
      git(["checkout", "-b", "feature"]);
      const f1 = await commit("b.txt", "f1");
      const f2 = await commit("a.txt", "f2 conflicts");
      const f3 = await commit("c.txt", "f3");
      git(["branch", "--set-upstream-to=main", "feature"]);
      git(["checkout", "main"]);
      const m1 = await commit("a.txt", "m1 conflicts");
      git(["checkout", "feature"]);
      expect(() => git(["rebase", "main"])).toThrow();
      const replayed = git(["rev-parse", "HEAD"]);

      // Tracked upstream keeps the upstream of the branch that the rebase rewrites.
      await expect(
        Effect.runPromise(
          service.getComparisonTarget({ repoPath: repo, target: { branch: "@{upstream}" } }),
        ),
      ).resolves.toEqual({ kind: "available", reference: "refs/heads/main" });

      const page = requirePage(await history("refs/heads/main"));
      expect(page.comparison.currentTip).toBe(replayed);
      expect(page.comparison.boundaryOids).toEqual([base]);
      const byOid = new Map(page.commits.map((entry) => [entry.oid, entry]));
      // The replayed commit on HEAD, the old commits of the branch, and the target all show.
      expect([...byOid.keys()].sort()).toEqual([replayed, f1, f2, f3, m1, base].sort());
      expect(byOid.get(replayed)).toMatchObject({ membership: "current", parentOids: [m1] });
      expect(byOid.get(f3)).toMatchObject({
        membership: "current",
        refs: [{ name: "feature", kind: "local", isHead: false }],
      });
      expect(byOid.get(f1)?.membership).toBe("current");
      expect(byOid.get(m1)?.membership).toBe("target");
      expect(byOid.get(base)?.membership).toBe("boundary");
      const order = page.commits.map((entry) => entry.oid);
      expect(order.indexOf(replayed)).toBeLessThan(order.indexOf(m1));
      expect(order.indexOf(f2)).toBeLessThan(order.indexOf(f1));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "reads the newest commit of the branch after a commit that the panel did not read",
    async () => {
      await commit("base.txt", "base");
      git(["checkout", "-b", "feature"]);
      await commit("a.txt", "first");
      const expectedBranch = await Effect.runPromise(service.getCurrentBranch({ repoPath: repo }));
      const newest = await commit("a.txt", "second");
      const read = (branch: typeof expectedBranch) =>
        Effect.runPromise(
          service.getHistoryPage({
            repoPath: repo,
            targetReference: "refs/heads/main",
            expectedBranch: branch,
          }),
        );

      // The panel still holds the older commit. The read follows the branch to its newest commit.
      expect(requirePage(await read(expectedBranch)).comparison.currentTip).toBe(newest);

      git(["checkout", "main"]);
      expect(await failure(read(expectedBranch))).toBe(
        "The branch changed. Refresh to read its History.",
      );
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "lists the author email and the branches and tags of each commit",
    async () => {
      const base = await commit("base.txt", "shared base");
      git(["tag", "-a", "v1.0.0", "-m", "Release"]);
      git(["tag", "light"]);
      git(["checkout", "-b", "feature"]);
      const tip = await commit("a.txt", "feature a");
      git(["branch", "feature-copy"]);
      // A remote-tracking branch and the symbolic remote HEAD that repeats it.
      git(["update-ref", "refs/remotes/origin/feature", tip]);
      git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/feature"]);

      const page = requirePage(await history("main"));
      const refsOf = (oid: string) => page.commits.find((entry) => entry.oid === oid)?.refs;

      expect(page.commits.map((entry) => entry.authorEmail)).toEqual([
        "history@example.invalid",
        "history@example.invalid",
      ]);
      // The checked-out branch comes first, then local branches, remote branches, and tags.
      expect(refsOf(tip)).toEqual([
        { name: "feature", kind: "local", isHead: true },
        { name: "feature-copy", kind: "local", isHead: false },
        { name: "origin/feature", kind: "remote", isHead: false },
      ]);
      // The annotated tag peels to its commit.
      expect(refsOf(base)).toEqual([
        { name: "main", kind: "local", isHead: false },
        { name: "light", kind: "tag", isHead: false },
        { name: "v1.0.0", kind: "tag", isHead: false },
      ]);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "handles matching tips and a target that is ahead only",
    async () => {
      const shared = await commit("base.txt", "shared");
      git(["branch", "target"]);

      const same = requirePage(await history("refs/heads/target"));
      expect(same.commits.map((entry) => [entry.oid, entry.membership])).toEqual([
        [shared, "boundary"],
      ]);
      expect(same.comparison.aheadBehind).toEqual({ ahead: 0, behind: 0 });

      git(["checkout", "target"]);
      const missing = await commit("t.txt", "missing on main");
      git(["checkout", "main"]);
      const behind = requirePage(await history("refs/heads/target"));
      expect(behind.commits.map((entry) => [entry.oid, entry.membership])).toEqual([
        [missing, "target"],
        [shared, "boundary"],
      ]);
      expect(behind.comparison.aheadBehind).toEqual({ ahead: 0, behind: 1 });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "pages with pinned tips and rejects a page after a tip moves",
    async () => {
      await commit("base.txt", "base");
      git(["checkout", "-b", "feature"]);
      // Fast import writes many commits in one Git process.
      const count = GIT_HISTORY_PAGE_SIZE + 5;
      const stream = [`reset refs/heads/feature\nfrom ${git(["rev-parse", "HEAD"])}\n`];
      for (let index = 0; index < count; index += 1) {
        stream.push(
          `commit refs/heads/feature\ncommitter T <t@example.invalid> ${1_700_000_000 + index} +0000\ndata ${`c${index}`.length}\nc${index}\n\n`,
        );
      }
      git(["fast-import", "--quiet"], stream.join(""));
      git(["reset", "--hard", "-q", "feature"]);

      const first = requirePage(await history("refs/heads/main"));
      expect(first.commits).toHaveLength(GIT_HISTORY_PAGE_SIZE);
      expect(first.nextOffset).toBe(GIT_HISTORY_PAGE_SIZE);
      const pageInput = {
        currentTip: first.comparison.currentTip,
        targetTip: first.comparison.targetTip,
        offset: GIT_HISTORY_PAGE_SIZE,
      };
      const second = requirePage(await history("refs/heads/main", pageInput));
      // The remaining feature commits, then the boundary commit.
      expect(second.commits).toHaveLength(count - GIT_HISTORY_PAGE_SIZE + 1);
      expect(second.nextOffset).toBeNull();
      expect(second.commits.at(-1)?.membership).toBe("boundary");

      await commit("later.txt", "later");
      expect(await failure(history("refs/heads/main", pageInput))).toContain(
        "The branches changed while History loaded",
      );
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "reports a branch without commits, a missing target, and unrelated histories",
    async () => {
      expect(await history("refs/heads/main")).toEqual({ outcome: "no_commits" });

      const mainTip = await commit("base.txt", "main");
      expect(await failure(history("refs/heads/missing"))).toContain(
        "Comparison branch refs/heads/missing is unavailable",
      );

      git(["checkout", "--orphan", "lonely"]);
      git(["rm", "-rfq", "."]);
      const lonelyTip = await commit("lonely.txt", "lonely");
      expect(await history("refs/heads/main")).toEqual({
        outcome: "no_common_ancestor",
        currentTip: lonelyTip,
        targetTip: mainTip,
        shallow: false,
      });
    },
    GIT_TEST_TIMEOUT_MS,
  );
});
