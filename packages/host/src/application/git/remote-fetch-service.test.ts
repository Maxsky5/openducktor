import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { createRemoteFetchService } from "./remote-fetch-service";

const createHarness = (fetchRemote: (remote: string) => Effect.Effect<string> = Effect.succeed) => {
  const calls: string[] = [];
  const service = createRemoteFetchService({
    fetchRemote: (repoPath, remote) =>
      Effect.suspend(() => {
        calls.push(`${repoPath}:${remote}`);
        return fetchRemote(remote);
      }),
  });
  return { service, calls };
};

const runWithClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));

describe("remote fetch service", () => {
  test("skips a remote that a fetch of the last 5 minutes updated, unless forced", async () => {
    const { service, calls } = createHarness();
    const fetch = (remote: string, force = false) =>
      service.fetch({ repoPath: "/repo", remote, force });

    const outcomes = await runWithClock(
      Effect.gen(function* () {
        const first = yield* fetch("origin");
        const fresh = yield* fetch("origin");
        // Another remote has its own fetch time.
        const backup = yield* fetch("backup");
        const forced = yield* fetch("origin", true);
        yield* TestClock.adjust("5 minutes");
        const stale = yield* fetch("origin");
        return [first, fresh, backup, forced, stale].map((result) => result.outcome);
      }),
    );

    expect(outcomes).toEqual(["fetched", "fresh", "fetched", "fetched", "fetched"]);
    expect(calls).toEqual(["/repo:origin", "/repo:backup", "/repo:origin", "/repo:origin"]);
  });

  test("a call during a fetch of the same remote waits for that fetch", async () => {
    const release = Deferred.makeUnsafe<void>();
    const { service, calls } = createHarness((remote) =>
      Deferred.await(release).pipe(Effect.as(`Fetched ${remote}`)),
    );

    const results = await runWithClock(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          service.fetch({ repoPath: "/repo", remote: "origin", force: false }),
        );
        yield* Effect.yieldNow;
        const forced = yield* Effect.forkChild(
          service.fetch({ repoPath: "/repo", remote: "origin", force: true }),
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(forced)];
      }),
    );

    expect(results).toEqual([
      { outcome: "fetched", output: "Fetched origin" },
      { outcome: "fetched", output: "Fetched origin" },
    ]);
    expect(calls).toEqual(["/repo:origin"]);
  });

  test("a fetch that does not finish in time fails, and the next call fetches again", async () => {
    let hangs = true;
    const { service, calls } = createHarness((remote) =>
      hangs ? Effect.never : Effect.succeed(`Fetched ${remote}`),
    );
    const fetch = () => service.fetch({ repoPath: "/repo", remote: "origin", force: false });

    const [failure, retry] = await runWithClock(
      Effect.gen(function* () {
        const pending = yield* Effect.forkChild(Effect.flip(fetch()));
        yield* TestClock.adjust("61 seconds");
        const failed = yield* Fiber.join(pending);
        hangs = false;
        return [failed, yield* fetch()] as const;
      }),
    );

    expect(failure.message).toBe("git fetch origin did not finish in time.");
    expect(retry).toEqual({ outcome: "fetched", output: "Fetched origin" });
    expect(calls).toEqual(["/repo:origin", "/repo:origin"]);
  });
});
