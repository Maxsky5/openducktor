import { describe, expect, test } from "bun:test";
import type { JsonValue } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createModelNamingService } from "../../test-support/naming-test-doubles";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { nameBranch, type BranchNamingRequest } from "./branch-naming";

const namingModel = { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5-mini" } as const;

const name = (
  answer: Effect.Effect<JsonValue, HostOperationError>,
  {
    refs = [],
    remotes = ["origin"],
    model = true,
    request = {},
  }: {
    refs?: string[];
    remotes?: string[];
    model?: boolean;
    request?: Partial<BranchNamingRequest>;
  } = {},
) => {
  const { service, requests } = createModelNamingService(() => answer);
  const git = createGitPortTestDouble({
    listRefNames: () => Effect.succeed(refs),
    listRemoteNames: () => Effect.succeed(remotes),
  });
  const named = Effect.runPromise(
    nameBranch(
      { naming: service, git },
      {
        repoConfig: repoConfigFixture(model ? { namingModel } : {}),
        gitDirectory: "/repo",
        workText: "Task title: Fix login redirect",
        reserved: ["feat/target"],
        fallback: "odt/task-1-fix-login-redirect",
        withTitle: false,
        ...request,
      },
    ),
  );
  return { named, requests };
};

describe("branch naming", () => {
  test("uses the model branch, and keeps a free fallback for a failed Git change", async () => {
    expect(await name(Effect.succeed({ branch: "fix/login" })).named).toEqual({
      branch: "fix/login",
      generated: true,
      fallback: "odt/task-1-fix-login-redirect",
      title: null,
      notice: null,
    });
  });

  test("names a branch and a title in one request", async () => {
    const { named, requests } = name(Effect.succeed({ branch: "fix/login", title: "Login fix" }), {
      request: { withTitle: true },
    });
    expect(await named).toMatchObject({ branch: "fix/login", title: "Login fix" });
    expect(requests).toHaveLength(1);
  });

  test.each([
    ["a local branch", ["refs/heads/feat/a"], [], "feat/a", "feat/a-2"],
    ["a reserved name", [], [], "feat/target", "feat/target-2"],
    ["a branch inside the name", ["refs/heads/fix/login/old"], [], "fix/login", "fix/login-2"],
    ["a remote branch", ["refs/remotes/origin/fix/login"], ["origin"], "fix/login", "fix/login-2"],
    [
      "a branch of overlapping remotes",
      ["refs/remotes/origin/fix/login"],
      ["origin", "origin/fix"],
      "fix/login",
      "fix/login-2",
    ],
    [
      "a branch of a remote with a slash",
      ["refs/remotes/team/origin/fix/login"],
      ["team/origin"],
      "fix/login",
      "fix/login-2",
    ],
  ])("adds a suffix when %s has the name", async (_case, refs, remotes, branch, free) => {
    expect((await name(Effect.succeed({ branch }), { refs, remotes }).named).branch).toBe(free);
  });

  test("keeps a free model branch when a branch blocks the unused fallback", async () => {
    expect(
      await name(Effect.succeed({ branch: "fix/login" }), { refs: ["refs/heads/odt"] }).named,
    ).toEqual({ branch: "fix/login", generated: true, fallback: null, title: null, notice: null });
  });

  test("uses the free fallback when a branch is a folder of the model branch", async () => {
    const named = await name(Effect.succeed({ branch: "fix/login" }), {
      refs: ["refs/heads/fix", "refs/heads/odt/task-1-fix-login-redirect"],
    }).named;
    expect(named).toMatchObject({ branch: "odt/task-1-fix-login-redirect-2", generated: false });
    expect(named.notice).toContain(
      "Git cannot create branch fix/login, because the branch fix exists.",
    );
    expect(named.notice).toContain("OpenDucktor used the branch odt/task-1-fix-login-redirect-2.");
  });

  test("uses the fallback without a notice after a time-out or without a naming model", async () => {
    const timedOut = await name(Effect.never).named;
    expect(timedOut).toMatchObject({ branch: "odt/task-1-fix-login-redirect", notice: null });
    const { named, requests } = name(Effect.succeed({ branch: "fix/login" }), { model: false });
    expect(await named).toMatchObject({
      branch: "odt/task-1-fix-login-redirect",
      generated: false,
    });
    expect(requests).toEqual([]);
  });

  test("says why naming failed when it uses the fallback", async () => {
    const named = await name(
      Effect.fail(new HostOperationError({ operation: "test", message: "Codex stopped." })),
      { request: { withTitle: true } },
    ).named;
    expect(named.notice).toBe(
      "The naming model could not name this work, so OpenDucktor used the branch odt/task-1-fix-login-redirect and the default title. Codex stopped. Check the naming model in the workspace settings, or clear it to stop naming.",
    );
  });

  test("fails when a branch is a folder of the fallback", () =>
    expect(
      name(Effect.succeed({ branch: "fix/login" }), {
        model: false,
        refs: ["refs/heads/odt/task-1-fix-login-redirect/old", "refs/heads/odt"],
      }).named,
    ).rejects.toThrow(
      "Git cannot create branch odt/task-1-fix-login-redirect, because the branch odt exists.",
    ));
});
