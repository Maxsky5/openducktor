// The sample data of the CI Checks scene: the checks of pull request 42 at each refresh, the times
// of each read, and the Builder rows of the pull request turn. The check names come from the
// sample of the workflow. The times are fictional. Sources: messages.pull_request in
// packages/workflows/src/builtin/spec-plan-build/prompt-templates.ts, and
// task-execution-ci-check-card.tsx, which shows the provider details and the times of a check.
import type { CheckState, CiCheck } from "../../replicas/studio/model";
import type { CallData } from "../../replicas/transcript/model";
import { bash } from "../../sample/calls";
import { CI_CHECKS } from "../../sample/studio";
import { TASK_BRANCH } from "../../sample/worktree";

export const PR_NUMBER = 42;

/** The check that fails on the first run, and passes after the fix of the Builder. */
export const FAILING = "test";

/** The states of the checks for each read of the panel, by check name. */
type Read = { updated: string; states: Readonly<Record<string, CheckState>> };

const read = (updated: string, failing: CheckState, build: CheckState): Read => ({
  updated,
  states: { lint: "success", typecheck: "success", [FAILING]: failing, build },
});

export const READS = {
  /** The panel opened while the last two checks ran. */
  first: read("10:26:10 AM", "pending", "pending"),
  /** The test check failed, and the build check passed. */
  failed: read("10:26:48 AM", "failure", "success"),
  /** The Builder pushed a fix, and the test check runs again. */
  rerun: read("10:27:52 AM", "pending", "success"),
  /** Every check passed. */
  passed: read("10:29:41 AM", "success", "success"),
} as const satisfies Record<string, Read>;

/** The checks of the last frame. Only the failed test run has the rows that the scene opens. */
export const CHECKS: readonly CiCheck[] = CI_CHECKS.map((name) =>
  name === FAILING
    ? {
        name,
        state: READS.passed.states[name] ?? "success",
        info: {
          workflow: "CI",
          details: "Process completed with exit code 1.",
          started: "11/8/2026, 10:24:52 AM",
          completed: "11/8/2026, 10:26:41 AM",
        },
      }
    : { name, state: READS.passed.states[name] ?? "success" },
);

/**
 * The shell commands of the pull request turn of the Builder, in the tool runs that the rows
 * between them divide: before the Set Pull Request card, before the reply about the failed check,
 * and before the final reply.
 */
export const RUNS = {
  publish: [
    bash("checks", "bun run lint && bun test", "6.1s", "10:24:16 AM"),
    bash("publish", `git push -u origin ${TASK_BRANCH}`, "1.4s", "10:24:31 AM"),
    bash(
      "create",
      'gh pr create --base main --title "feat(search): open search from anywhere with Cmd+K"',
      "1.9s",
      "10:24:40 AM",
    ),
  ],
  watch: [
    bash("watch", `gh pr checks ${PR_NUMBER} --watch`, "1m58s", "10:24:47 AM"),
    bash("log", "gh run view --log-failed", "1.2s", "10:26:52 AM"),
  ],
  fix: [
    bash("test", "bun test src/search", "2.4s", "10:27:31 AM"),
    bash("push", `git push origin ${TASK_BRANCH}`, "1.1s", "10:27:40 AM"),
    bash("rewatch", `gh pr checks ${PR_NUMBER} --watch`, "1m52s", "10:27:43 AM"),
  ],
} as const satisfies Record<string, readonly CallData[]>;

/** The reply of the Builder after it reads the failed log. */
export const CAUSE =
  "The test check failed: `closes search with Escape` expects one close call and gets two. I fix the hook so that a repeated key does nothing.";

/** The final reply of the turn. */
export const FINAL =
  "Pull request #42 is ready. The test check failed once, and I pushed a fix. All 4 required checks pass now: lint, typecheck, test, and build.";
