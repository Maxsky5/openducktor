import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitHistoryPage, GitHistoryPageRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { GIT_HISTORY_PAGE_SIZE } from "../../infrastructure/git/git-history";
import { gitFixtureCommand, gitFixtureEnv } from "../../test-support/git-repository-fixture";
import { createGitService } from "./git-service";

// These tests start real Git processes, because the commit graph belongs to Git.
// Real Git processes start slowly on Windows runners, so each test gets more time.
const GIT_TEST_TIMEOUT_MS = 30_000;
const service = createGitService(
  createGitCliAdapter({
    resolveCommand: () => Effect.succeed(gitFixtureCommand),
    readEnv: () => gitFixtureEnv,
  }),
);

let repo = "";
let emptyTree = "";
const git = (args: string[], input?: string, env = gitFixtureEnv) =>
  execFileSync(gitFixtureCommand, args, {
    cwd: repo,
    encoding: "utf8",
    env,
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const commitFile = async (file: string, message: string) => {
  await writeFile(path.join(repo, file), `${message}\n`);
  git(["add", file]);
  git(["commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
};

// These graph fixtures only need commit objects and refs.
const graphCommit = (message: string, parents: string[] = [], env = gitFixtureEnv) =>
  git(
    ["commit-tree", emptyTree, ...parents.flatMap((oid) => ["-p", oid]), "-m", message],
    undefined,
    env,
  );

const createRefs = (refs: Record<string, string>): void => {
  const input = Object.entries(refs)
    .map(([ref, oid]) => `create ${ref} ${oid}\n`)
    .join("");
  git(["update-ref", "--stdin"], input);
};

const history = (
  targetReference: string,
  expectedBranch: GitHistoryPageRequest["expectedBranch"],
  page?: GitHistoryPageRequest["page"],
): Promise<GitHistoryPage> => {
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

let template = "";
// Git process starts are slow on Windows runners, so the configured empty repository is made once
// for the file. Each test copies it without a Git process.
beforeAll(async () => {
  template = await mkdtemp(path.join(tmpdir(), "git-history-template-"));
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.name", "History Test"],
    ["config", "user.email", "history@example.invalid"],
    ["config", "commit.gpgsign", "false"],
  ]) {
    execFileSync(gitFixtureCommand, args, {
      cwd: template,
      env: gitFixtureEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  emptyTree = execFileSync(gitFixtureCommand, ["mktree"], {
    cwd: template,
    env: gitFixtureEnv,
    input: "",
    encoding: "utf8",
  }).trim();
}, GIT_TEST_TIMEOUT_MS);

afterAll(async () => {
  await rm(template, { recursive: true, force: true });
});

beforeEach(async () => {
  repo = path.join(await mkdtemp(path.join(tmpdir(), "git-history-")), "repo");
  await cp(template, repo, { recursive: true });
});

afterEach(async () => {
  await rm(path.dirname(repo), { recursive: true, force: true });
});

describe("branch history", () => {
  test(
    "shows both sides, merge parents, the shared boundary, and commit metadata",
    async () => {
      const older = graphCommit("older shared");
      const base = graphCommit("shared base", [older]);
      const featureA = graphCommit("feature a", [base]);
      const mainM = graphCommit("main m", [base]);
      const merge = graphCommit("merge main", [featureA, mainM]);
      const subject = "feature \u001e b";
      const message = `${subject}\n\nLonger body line.`;
      const featureB = graphCommit(message, [merge]);
      const mainN = graphCommit("main n", [mainM]);
      createRefs({
        "refs/heads/main": mainN,
        "refs/heads/feature": featureB,
        "refs/heads/feature-copy": featureB,
        "refs/heads/boundary": mainM,
        "refs/remotes/origin/feature": featureB,
        "refs/tags/light": mainM,
      });
      git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/feature"]);
      git(["tag", "-a", "v1.0.0", mainM, "-m", "Release"]);
      git(["symbolic-ref", "HEAD", "refs/heads/feature"]);

      const page = requirePage(
        await history("refs/heads/main", { name: "feature", detached: false }),
      );

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
        subject,
        message,
        authorName: "History Test",
      });
      expect(new Set(page.commits.map((entry) => entry.authorEmail))).toEqual(
        new Set(["history@example.invalid"]),
      );
      expect(byOid.get(featureB)?.refs).toEqual([
        { name: "feature", kind: "local", isHead: true },
        { name: "feature-copy", kind: "local", isHead: false },
        { name: "origin/feature", kind: "remote", isHead: false },
      ]);
      expect(byOid.get(mainM)?.refs).toEqual([
        { name: "boundary", kind: "local", isHead: false },
        { name: "light", kind: "tag", isHead: false },
        { name: "v1.0.0", kind: "tag", isHead: false },
      ]);
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
      const datedCommit = (
        message: string,
        parents: string[],
        authorDay: string,
        commitDay: string,
      ) =>
        graphCommit(message, parents, {
          ...gitFixtureEnv,
          GIT_AUTHOR_DATE: `2026-01-${authorDay}T10:00:00Z`,
          GIT_COMMITTER_DATE: `2026-01-${commitDay}T10:00:00Z`,
        });
      const base = datedCommit("base", [], "01", "01");
      const f1 = datedCommit("f1", [base], "02", "02");
      const f2 = datedCommit("f2", [f1], "04", "03");
      const m1 = datedCommit("m1", [base], "03", "04");
      const m2 = datedCommit("m2", [m1], "05", "05");
      createRefs({ "refs/heads/main": m2, "refs/heads/feature": f2 });
      git(["symbolic-ref", "HEAD", "refs/heads/feature"]);

      const page = requirePage(
        await history("refs/heads/main", { name: "feature", detached: false }),
      );

      // The branches mix by the date that each row shows, and every parent stays below its child.
      expect(page.commits.map((entry) => entry.oid)).toEqual([m2, f2, m1, f1, base]);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "follows a rebase that stops on a conflict, as a Git tree does",
    async () => {
      const base = await commitFile("a.txt", "base");
      git(["checkout", "-b", "feature"]);
      const f1 = await commitFile("b.txt", "f1");
      const f2 = await commitFile("a.txt", "f2 conflicts");
      const f3 = await commitFile("c.txt", "f3");
      git(["branch", "--set-upstream-to=main", "feature"]);
      git(["checkout", "main"]);
      const m1 = await commitFile("a.txt", "m1 conflicts");
      git(["checkout", "feature"]);
      expect(() => git(["rebase", "--merge", "main"])).toThrow();
      const replayed = git(["rev-parse", "HEAD"]);

      const status = await Effect.runPromise(
        service.getWorktreeStatus({
          repoPath: repo,
          targetBranch: "HEAD",
          diffScope: "uncommitted",
        }),
      );
      expect(status.gitConflict).toMatchObject({
        currentBranch: "feature",
        targetBranch: m1,
        conflictedFiles: ["a.txt"],
      });

      // Tracked upstream keeps the upstream of the branch that the rebase rewrites.
      await expect(
        Effect.runPromise(
          service.getComparisonTarget({ repoPath: repo, target: { branch: "@{upstream}" } }),
        ),
      ).resolves.toEqual({ kind: "available", reference: "refs/heads/main" });

      const page = requirePage(await history("refs/heads/main", { detached: true }));
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
      const base = graphCommit("base");
      const first = graphCommit("first", [base]);
      createRefs({ "refs/heads/main": base, "refs/heads/feature": first });
      git(["symbolic-ref", "HEAD", "refs/heads/feature"]);
      const expectedBranch = { name: "feature", detached: false, revision: first };
      const newest = graphCommit("second", [first]);
      git(["update-ref", "refs/heads/feature", newest, first]);

      // The panel still holds the older commit. The read follows the branch to its newest commit.
      expect(
        requirePage(await history("refs/heads/main", expectedBranch)).comparison.currentTip,
      ).toBe(newest);

      git(["symbolic-ref", "HEAD", "refs/heads/main"]);
      expect(await failure(history("refs/heads/main", expectedBranch))).toBe(
        "The branch changed. Refresh to read its History.",
      );
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "handles matching tips and a target that is ahead only",
    async () => {
      const shared = graphCommit("shared");
      createRefs({ "refs/heads/main": shared, "refs/heads/target": shared });
      const expectedBranch = { name: "main", detached: false };

      const same = requirePage(await history("refs/heads/target", expectedBranch));
      expect(same.commits.map((entry) => [entry.oid, entry.membership])).toEqual([
        [shared, "boundary"],
      ]);
      expect(same.comparison.aheadBehind).toEqual({ ahead: 0, behind: 0 });

      const missing = graphCommit("missing on main", [shared]);
      git(["update-ref", "refs/heads/target", missing, shared]);
      const behind = requirePage(await history("refs/heads/target", expectedBranch));
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
      const base = graphCommit("base");
      git(["update-ref", "refs/heads/main", base]);
      // Fast import writes many commits in one Git process.
      const count = GIT_HISTORY_PAGE_SIZE + 5;
      const stream = [`reset refs/heads/feature\nfrom ${base}\n`];
      for (let index = 0; index < count; index += 1) {
        stream.push(
          `commit refs/heads/feature\ncommitter T <t@example.invalid> ${1_700_000_000 + index} +0000\ndata ${`c${index}`.length}\nc${index}\n\n`,
        );
      }
      git(["fast-import", "--quiet"], stream.join(""));
      git(["symbolic-ref", "HEAD", "refs/heads/feature"]);
      const expectedBranch = { name: "feature", detached: false };

      const first = requirePage(await history("refs/heads/main", expectedBranch));
      expect(first.commits).toHaveLength(GIT_HISTORY_PAGE_SIZE);
      expect(first.nextOffset).toBe(GIT_HISTORY_PAGE_SIZE);
      const pageInput = {
        currentTip: first.comparison.currentTip,
        targetTip: first.comparison.targetTip,
        offset: GIT_HISTORY_PAGE_SIZE,
      };
      const second = requirePage(await history("refs/heads/main", expectedBranch, pageInput));
      // The remaining feature commits, then the boundary commit.
      expect(second.commits).toHaveLength(count - GIT_HISTORY_PAGE_SIZE + 1);
      expect(second.nextOffset).toBeNull();
      expect(second.commits.at(-1)?.membership).toBe("boundary");

      const later = graphCommit("later", [pageInput.currentTip]);
      git(["update-ref", "refs/heads/feature", later, pageInput.currentTip]);
      expect(await failure(history("refs/heads/main", expectedBranch, pageInput))).toContain(
        "The branches changed while History loaded",
      );
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "reports a branch without commits, a missing target, and unrelated histories",
    async () => {
      const main = { name: "main", detached: false };
      expect(await history("refs/heads/main", main)).toEqual({ outcome: "no_commits" });

      const mainTip = graphCommit("main");
      git(["update-ref", "refs/heads/main", mainTip]);
      expect(await failure(history("refs/heads/missing", main))).toContain(
        "Comparison branch refs/heads/missing is unavailable",
      );

      const lonelyTip = graphCommit("lonely");
      git(["update-ref", "refs/heads/lonely", lonelyTip]);
      git(["symbolic-ref", "HEAD", "refs/heads/lonely"]);
      expect(await history("refs/heads/main", { name: "lonely", detached: false })).toEqual({
        outcome: "no_common_ancestor",
        currentTip: lonelyTip,
        targetTip: mainTip,
        shallow: false,
      });
    },
    GIT_TEST_TIMEOUT_MS,
  );
});
