import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { repoConfigFixture } from "../../../test-support/repo-config-fixture";
import { createGitPortTestDouble } from "../../../test-support/service-test-doubles";
import type { NamingOutcome, NamingRequest, NamingService } from "../../naming/naming-service";
import { chooseTaskBranch } from "./task-branch-naming";

const task = { id: "task-1", title: "Fix login redirect", description: "After OAuth." };

const choose = (
  outcome: NamingOutcome,
  { model = true, existing = [] }: { model?: boolean; existing?: readonly string[] } = {},
) => {
  const requests: NamingRequest[] = [];
  const naming: NamingService = {
    generate: (request) => Effect.sync(() => (requests.push(request), outcome)),
  };
  const repoConfig = repoConfigFixture({
    branchPrefix: "odt",
    ...(model && {
      namingModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5-mini" },
    }),
  });
  const gitPort = createGitPortTestDouble({
    listRemoteNames: () => Effect.succeed(["origin"]),
    listRefNames: () => Effect.succeed([...existing]),
  });
  const { branch, generated } = Effect.runSync(
    chooseTaskBranch({ naming, gitPort }, { repoConfig, repoPath: "/repo", task }),
  );
  return { branch, generated, requests };
};

describe("task worktree branch", () => {
  test("uses the model branch from the task title and description", () => {
    const { branch, generated, requests } = choose({
      kind: "generated",
      branch: "fix/oauth-login-redirect",
    });
    expect(branch).toBe("fix/oauth-login-redirect");
    expect(generated).toBe(true);
    expect(requests).toMatchObject([
      {
        outputs: { title: false, branch: true },
        workText: "Task title: Fix login redirect\n\nTask description:\nAfter OAuth.",
      },
    ]);
  });

  test("adds a suffix when the model branch exists", () => {
    const { branch } = choose(
      { kind: "generated", branch: "fix/login" },
      { existing: ["refs/heads/fix/login"] },
    );
    expect(branch).toBe("fix/login-2");
  });

  test("skips a name that a remote branch or the target branch has", () => {
    const remote = choose(
      { kind: "generated", branch: "feat/release" },
      { existing: ["refs/remotes/origin/feat/release"] },
    );
    expect(remote.branch).toBe("feat/release-2");
    expect(choose({ kind: "generated", branch: "main" }).branch).toBe("main-2");
  });

  test("uses the task title branch when a branch folder blocks the model name", () => {
    const { branch } = choose(
      { kind: "generated", branch: "fix/login" },
      { existing: ["refs/remotes/origin/fix"] },
    );
    expect(branch).toBe("odt/task-1-fix-login-redirect");
  });

  test.each([
    ["a time-out", { kind: "timed_out" }],
    ["a naming error", { kind: "failed", message: "Codex stopped." }],
  ] as const)("uses the task title branch after %s", (_case, outcome) => {
    expect(choose(outcome)).toMatchObject({
      branch: "odt/task-1-fix-login-redirect",
      generated: false,
    });
  });

  test("makes no request without a naming model", () => {
    const { branch, requests } = choose({ kind: "disabled" }, { model: false });
    expect(branch).toBe("odt/task-1-fix-login-redirect");
    expect(requests).toEqual([]);
  });
});
