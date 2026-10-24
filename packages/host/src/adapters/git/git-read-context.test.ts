import { describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createGitCliAdapter } from "./git-cli-adapter";

describe("Git logical read context", () => {
  test("shares pending raw status and its failure, then reads fresh data for a new ID", async () => {
    const started = Effect.runSync(Deferred.make<void>()),
      release = Effect.runSync(Deferred.make<void>());
    let statusReads = 0,
      fail = true;
    const failure = new HostOperationError({
      operation: "git.status",
      message: "Git status is unavailable",
    });
    const git = createGitCliAdapter({
      runner: (_dir, args) =>
        Effect.gen(function* () {
          if (args[0] === "rev-parse")
            return { ok: true, stdout: `${process.cwd()}\n`, stderr: "" };
          if (args[0] !== "status") return yield* Effect.die("Unexpected Git command");
          statusReads += 1;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          if (fail) return yield* failure;
          return { ok: true, stdout: "R  renamed.txt\0original.txt\0", stderr: "" };
        }),
    });
    const pending = Effect.runPromise(
      Effect.all(
        [
          Effect.result(git.getStatus("/repo", { refreshId: "same" })),
          Effect.result(git.getStatus("/repo/subdir", { refreshId: "same" })),
        ],
        { concurrency: "unbounded" },
      ),
    );
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const outcomes = await pending;
    expect(statusReads).toBe(1);
    for (const outcome of outcomes) {
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") expect(outcome.failure).toBe(failure);
    }
    fail = false;
    await expect(Effect.runPromise(git.getStatus("/repo", { refreshId: "same" }))).rejects.toThrow(
      "Git status is unavailable",
    );
    expect(statusReads).toBe(1);
    expect(await Effect.runPromise(git.getStatus("/repo", { refreshId: "next" }))).toEqual([
      { path: "renamed.txt", originalPath: "original.txt", status: "renamed", staged: true },
    ]);
    expect(statusReads).toBe(2);
    await Effect.runPromise(git.releaseReadCaptures());
    await Effect.runPromise(git.getStatus("/repo", { refreshId: "next" }));
    expect(statusReads).toBe(3);
  });

  test("shares checkout reads and the worktree list of one refresh", async () => {
    const commands: string[] = [];
    const directory = process.cwd();
    const git = createGitCliAdapter({
      runner: (dir, args) =>
        Effect.sync(() => {
          commands.push(`${args[0]} ${dir}`);
          if (args[0] === "rev-parse")
            return { ok: true, stdout: `true\n${directory}\n${directory}\n`, stderr: "" };
          if (args[0] === "worktree")
            return {
              ok: true,
              stdout: `worktree ${directory}\0branch refs/heads/main\0\0`,
              stderr: "",
            };
          throw new Error(`Unexpected Git command: ${args.join(" ")}`);
        }),
    });
    const refresh = { refreshId: "refresh" };
    const checks = Effect.all(
      [
        git.readCheckout(directory, refresh),
        git.readCheckout(directory, refresh),
        git.isRegisteredWorktree("/repo", directory, refresh),
        git.isRegisteredWorktree("/repo", "/elsewhere", refresh),
      ],
      { concurrency: "unbounded" },
    );
    expect(await Effect.runPromise(checks)).toEqual([
      { root: directory, commonDirectory: directory },
      { root: directory, commonDirectory: directory },
      true,
      false,
    ]);
    expect(commands).toEqual([`rev-parse ${directory}`, "worktree /repo"]);

    await Effect.runPromise(git.readCheckout(directory, { refreshId: "next" }));
    await Effect.runPromise(git.isRegisteredWorktree("/repo", directory));
    expect(commands).toEqual([
      `rev-parse ${directory}`,
      "worktree /repo",
      `rev-parse ${directory}`,
      "worktree /repo",
    ]);
  });
});
