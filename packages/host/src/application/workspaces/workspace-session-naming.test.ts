import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { HostOperationError } from "../../effect/host-errors";
import type { JsonValue } from "@openducktor/contracts";
import type { HostError } from "../../effect/host-errors";
import { createModelNamingService } from "../../test-support/naming-test-doubles";
import {
  createPersistenceHarness,
  waitFor,
} from "./test-support/workspace-session-runtime-persistence-harness";
import { requireConfirmedAutomaticBranch } from "./workspace-session-branch-rename";

const NAMING_MODEL = { runtimeKind: "claude", providerId: "anthropic", modelId: "haiku" } as const;

describe("Workspace Session naming", () => {
  let database: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    database = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await database.cleanup();
  });

  /** A harness whose chat this host created, with a naming model that gives `answer`, and Git fakes. */
  const setup = async (
    temporaryBranch: string | null,
    answer: Effect.Effect<JsonValue, HostError>,
  ) => {
    const h = await createPersistenceHarness(database);
    h.config.namingModel = NAMING_MODEL;
    const model = createModelNamingService(() => answer);
    const requests = model.requests;
    const existing = new Set<string>();
    const renames: Array<[string, string, string]> = [];
    let deliveredBeforeRename = 0;
    h.persistence.registerCreated(h.storeRef, temporaryBranch);
    const renameFailures = new Map<string, string>();
    const upstreams: Array<[string, string]> = [];
    const upstreamFailures = new Map<string, string>();
    h.naming.service = model.service;
    h.naming.git = createGitPortTestDouble({
      listRefNames: () => Effect.succeed([...existing]),
      listRemoteNames: () => Effect.succeed(["team/origin"]),
      renameCheckedOutBranch: (directory, expected, branch) => {
        const failure = renameFailures.get(branch);
        if (failure !== undefined)
          return Effect.fail(new HostOperationError({ operation: "test", message: failure }));
        return Effect.sync(() => {
          deliveredBeforeRename += h.inputs.length;
          renames.push([directory, expected, branch]);
        });
      },
      configureBranchUpstream: (_repo, _directory, branch, remote, requireNewTrackingRef) => {
        expect(requireNewTrackingRef).toBe(true);
        const failure = upstreamFailures.get(branch);
        if (failure !== undefined)
          return Effect.fail(new HostOperationError({ operation: "test", message: failure }));
        return Effect.sync(() => {
          upstreams.push([branch, remote]);
          return null;
        });
      },
    });
    return {
      h,
      requests,
      existing,
      renames,
      renameFailures,
      upstreams,
      upstreamFailures,
      deliveredBeforeRename: () => deliveredBeforeRename,
    };
  };

  test("renames a temporary branch before the agent gets the first message", async () => {
    const { h, requests, renames, deliveredBeforeRename } = await setup(
      "feature/session",
      Effect.succeed({ title: "OAuth login redirect", branch: "fix/oauth-login-redirect" }),
    );
    await h.send("Fix login redirect after OAuth");

    expect(requests.map(({ outputSchema }) => outputSchema["required"])).toEqual([
      ["branch", "title"],
    ]);
    expect(requests[0]?.prompt).toContain("First message:\nFix login redirect after OAuth");
    expect(renames).toEqual([
      [h.ref.workingDirectory, "feature/session", "fix/oauth-login-redirect"],
    ]);
    expect(deliveredBeforeRename()).toBe(0);
    expect(h.inputs).toHaveLength(1);
    const saved = await h.get();
    expect(saved.executionTarget).toMatchObject({ branchName: "fix/oauth-login-redirect" });
    await waitFor(async () => (await h.get()).generatedTitle === "OAuth login redirect");
    // The title came with the branch, so no second request runs.
    expect(requests).toHaveLength(1);
    expect(h.renameFailures).toEqual([]);
  });

  test("saves the renamed branch on the next send when the first save fails", async () => {
    const { h, renames } = await setup(
      "feature/session",
      Effect.succeed({ branch: "fix/login", title: "Login fix" }),
    );
    h.state.failTargetSave = true;
    await expect(h.send("Fix login")).rejects.toThrow("target save failed");
    expect(h.inputs).toHaveLength(0);

    h.state.failTargetSave = false;
    await h.send("Fix login");

    expect(renames).toHaveLength(1);
    expect((await h.get()).executionTarget).toMatchObject({ branchName: "fix/login" });
    expect(h.inputs).toHaveLength(1);
  });

  test("sets the upstream of the final branch on the remote of the target branch", async () => {
    const { h, upstreams } = await setup(
      "feature/session",
      Effect.succeed({ branch: "fix/login", title: "Login fix" }),
    );
    h.config.defaultTargetBranch = { remote: "origin", branch: "main" };
    await h.send("Fix login");

    expect(upstreams).toEqual([["fix/login", "origin"]]);
  });

  test("renames back and uses the first-message branch when the model branch cannot track", async () => {
    const { h, renames, upstreams, upstreamFailures } = await setup(
      "feature/session",
      Effect.succeed({ branch: "fix/login", title: "Login fix" }),
    );
    h.config.defaultTargetBranch = { remote: "origin", branch: "main" };
    upstreamFailures.set("fix/login", "The remote branch origin/fix/login appeared.");
    await h.send("Repair the sign in page");

    expect(renames.map(([, from, to]) => [from, to])).toEqual([
      ["feature/session", "fix/login"],
      ["fix/login", "feature/session"],
      ["feature/session", "odt/repair-the-sign-in-page"],
    ]);
    expect(upstreams).toEqual([["odt/repair-the-sign-in-page", "origin"]]);
    expect((await h.get()).executionTarget).toMatchObject({
      branchName: "odt/repair-the-sign-in-page",
    });
  });

  test("adds a suffix when a local or remote branch has the model name", async () => {
    const { h, existing, renames } = await setup(
      "feature/session",
      Effect.succeed({ title: "Login fix", branch: "fix/login" }),
    );
    existing.add("refs/heads/fix/login");
    existing.add("refs/remotes/team/origin/fix/login-2");
    await h.send("Fix login");
    expect(renames.map(([, , branch]) => branch)).toEqual(["fix/login-3"]);
  });

  test("uses the first-message branch when a branch folder blocks the model name", async () => {
    const { h, existing, renames } = await setup(
      "feature/session",
      Effect.succeed({ title: "Login fix", branch: "fix/login" }),
    );
    existing.add("refs/remotes/team/origin/fix");
    existing.add("refs/heads/odt/fix-login/old");
    await h.send("Fix login");
    expect(renames.map(([, , branch]) => branch)).toEqual(["odt/fix-login-2"]);
    expect(h.renameFailures[0]).toContain("the branch fix exists");
  });

  test("withholds the message and reports both Git errors when no rename works", async () => {
    const { h, renames, renameFailures } = await setup(
      "feature/session",
      Effect.succeed({ title: "Login fix", branch: "fix/login" }),
    );
    renameFailures.set("fix/login", "upstream failed");
    renameFailures.set("odt/fix-login", "branch moved");
    const error = await h.send("Fix login").catch((cause: unknown) => cause);
    expect(String(error)).toContain("upstream failed");
    expect(String(error)).toContain("branch moved");
    expect(renames).toEqual([]);
    expect(h.inputs).toEqual([]);
  });

  test("uses the shortened message after a time-out, with no notice", async () => {
    const { h, renames } = await setup("feature/session", Effect.never);
    await h.send("Fix login redirect after OAuth, then run the tests");
    expect(renames.map(([, , branch]) => branch)).toEqual([
      "odt/fix-login-redirect-after-oauth-then",
    ]);
    expect(h.renameFailures).toEqual([]);
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
  });

  test("uses the shortened message after a naming error, with a notice", async () => {
    const { h, renames } = await setup(
      "feature/session",
      Effect.fail(
        new HostOperationError({ operation: "test", message: "Claude is not signed in." }),
      ),
    );
    await h.send("Fix login");
    expect(renames.map(([, , branch]) => branch)).toEqual(["odt/fix-login"]);
    expect(h.renameFailures).toHaveLength(1);
    expect(h.renameFailures[0]).toContain("Claude is not signed in.");
    expect(h.renameFailures[0]).toContain("odt/fix-login");
  });

  test("keeps a typed branch and names the title without delaying the message", async () => {
    const pending = Effect.runSync(Deferred.make<JsonValue, HostError>());
    const { h, requests, renames } = await setup(null, Deferred.await(pending));
    await h.send("Fix login redirect after OAuth");

    expect(renames).toEqual([]);
    expect(h.inputs).toHaveLength(1);
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    await waitFor(() => requests.length === 1);
    expect(requests[0]?.outputSchema["required"]).toEqual(["title"]);
    Effect.runSync(Deferred.succeed(pending, { title: "OAuth login redirect" }));
    await waitFor(async () => (await h.get()).generatedTitle === "OAuth login redirect");
    expect((await h.get()).executionTarget).toMatchObject({ branchName: "feature/session" });
  });

  test("keeps a manual title that the user set before the model title arrives", async () => {
    const pending = Effect.runSync(Deferred.make<JsonValue, HostError>());
    const { h, requests } = await setup(null, Deferred.await(pending));
    await h.send("Fix login");
    await waitFor(() => requests.length === 1);
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "My title" }));
    Effect.runSync(Deferred.succeed(pending, { title: "Login fix" }));
    await waitFor(async () => (await h.get()).generatedTitle === "Login fix");
    expect((await h.get()).manualTitle).toBe("My title");
    expect(h.titleAttempts).not.toContain("Login fix");
  });

  test("asks only for the branch when the chat has a manual title", async () => {
    const { h, requests, renames } = await setup(
      "feature/session",
      Effect.succeed({ branch: "fix/login" }),
    );
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "My title" }));
    await h.send("Fix login");
    await Bun.sleep(5);
    expect(requests.map(({ outputSchema }) => outputSchema["required"])).toEqual([["branch"]]);
    expect(renames.map(([, , branch]) => branch)).toEqual(["fix/login"]);
  });

  test("asks no title for a chat with a typed branch and a manual title", async () => {
    const { h, requests } = await setup(null, Effect.succeed({ title: "Login fix" }));
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "My title" }));
    await h.send("Fix login");
    await Bun.sleep(5);
    expect(requests).toEqual([]);
  });

  test("names only the first message of a chat", async () => {
    const { h, requests } = await setup(null, Effect.succeed({ title: "Login fix" }));
    await h.send("Fix login");
    await waitFor(() => requests.length === 1);
    await h.send("Also fix logout");
    await Bun.sleep(5);
    expect(requests).toHaveLength(1);
  });

  test("makes no request for a chat that this host did not create", async () => {
    const h = await createPersistenceHarness(database);
    h.config.namingModel = NAMING_MODEL;
    let calls = 0;
    h.naming.service = {
      generate: () =>
        Effect.sync(() => (calls += 1)).pipe(Effect.as({ status: "disabled" as const })),
    };
    await h.send("Fix login");
    await Bun.sleep(5);
    expect(calls).toBe(0);
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
  });
});

describe("automatic chat worktree names", () => {
  const session = (id: string, workingDirectory: string, branchName: string | null) => ({
    id,
    executionTarget: {
      kind: "local_worktree" as const,
      workingDirectory,
      branchName,
      worktreeState: "present" as const,
    },
  });
  const id = "1a2b3c4d-0000-4000-8000-000000000000";

  test("stops an unproven temporary branch before the first message", async () => {
    const unproven = session(id, "/worktrees/workspace-sessions/1a2b3c4d", "odt/1a2b3c4d");
    const error = await Effect.runPromise(Effect.flip(requireConfirmedAutomaticBranch(unproven)));
    expect(error.message).toContain("git branch -m odt/1a2b3c4d <name>");
  });

  test("stops an unproven temporary branch after the prefix setting changed", async () => {
    const renamedPrefix = session(id, "/worktrees/workspace-sessions/1a2b3c4d", "old/1a2b3c4d");
    const error = await Effect.runPromise(
      Effect.flip(requireConfirmedAutomaticBranch(renamedPrefix)),
    );
    expect(error.message).toContain("git branch -m old/1a2b3c4d <name>");
  });

  test("allows a typed branch, a chat with activity, and a typed folder", async () => {
    const typed = session(id, "/worktrees/workspace-sessions/1a2b3c4d", "feature/typed");
    const active = {
      ...session(id, "/worktrees/workspace-sessions/1a2b3c4d", "odt/1a2b3c4d"),
      lastActivityAt: 1,
    };
    const typedFolder = session(id, "/worktrees/workspace-sessions/login", "odt/1a2b3c4d");
    for (const allowed of [typed, active, typedFolder])
      await Effect.runPromise(requireConfirmedAutomaticBranch(allowed));
  });
});
