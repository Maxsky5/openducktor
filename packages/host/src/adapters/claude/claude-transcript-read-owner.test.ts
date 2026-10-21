import { describe, expect, test } from "bun:test";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import { createClaudeTranscriptReadOwner } from "./claude-transcript-read-owner";
import type { ClaudeTranscriptReadResult } from "./claude-transcript-reader";

const input: LoadAgentSessionHistoryInput = {
  repoPath: "/repo",
  workingDirectory: "/repo/worktree",
  externalSessionId: "00000000-0000-4000-8000-000000000001",
  runtimeKind: "claude",
  runtimePolicy: { kind: "claude" },
};
const result: ClaudeTranscriptReadResult = {
  messages: [],
  source: { root: "/transcript", selected: "/transcript", sessionId: input.externalSessionId },
};

describe("Claude transcript read ownership", () => {
  test("shares overlapping reads only for the same source and scope", async () => {
    let reads = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const source = {
          read: () =>
            Effect.gen(function* () {
              reads += 1;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(finish);
              return result;
            }),
        };
        const owner = createClaudeTranscriptReadOwner(source);
        const otherOwner = createClaudeTranscriptReadOwner(source);
        const first = yield* Effect.forkChild(owner.read(input), { startImmediately: true });
        yield* Deferred.await(started);
        const requests = [
          owner.read({ ...input, limit: 1 }),
          owner.read({
            ...input,
            externalSessionId: claudeSubagentExternalSessionId(input.externalSessionId, "child"),
          }),
          owner.read({ ...input, workingDirectory: "/other/worktree" }),
          owner.read({ ...input, repoPath: "/other/repo" }),
          otherOwner.read(input),
        ];
        const callers = [];
        for (const request of requests)
          callers.push(yield* Effect.forkChild(request, { startImmediately: true }));
        expect(reads).toBe(5);
        yield* Deferred.succeed(finish, undefined);
        expect(yield* Fiber.join(first)).toBe(result);
        for (const caller of callers) expect(yield* Fiber.join(caller)).toBe(result);
        yield* owner.read(input);
        expect(reads).toBe(6);
        owner.dispose();
        otherOwner.dispose();
      }),
    );
  });

  test("keeps the source read alive when only one consumer cancels", async () => {
    let closed = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const owner = createClaudeTranscriptReadOwner({
          read: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.as(result),
              Effect.ensuring(Effect.sync(() => void (closed = true))),
            ),
        });
        const first = yield* Effect.forkChild(owner.read(input));
        yield* Deferred.await(started);
        const second = yield* Effect.forkChild(owner.read(input), { startImmediately: true });
        yield* Fiber.interrupt(first);
        expect(Exit.isFailure(yield* Fiber.await(first))).toBe(true);
        expect(closed).toBe(false);
        yield* Deferred.succeed(finish, undefined);
        expect(yield* Fiber.join(second)).toBe(result);
        expect(closed).toBe(true);
        owner.dispose();
      }),
    );
  });

  test("interrupts the source when all consumers cancel and permits a fresh read", async () => {
    let reads = 0;
    let closed = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const owner = createClaudeTranscriptReadOwner({
          read: () =>
            Effect.gen(function* () {
              reads += 1;
              if (reads > 1) return result;
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }).pipe(Effect.ensuring(Effect.sync(() => void (closed += 1)))),
        });
        const first = yield* Effect.forkChild(owner.read(input));
        yield* Deferred.await(started);
        const second = yield* Effect.forkChild(owner.read(input), { startImmediately: true });
        yield* Fiber.interrupt(first);
        expect(closed).toBe(0);
        yield* Fiber.interrupt(second);
        expect(closed).toBe(1);
        expect(yield* owner.read(input)).toBe(result);
        expect(reads).toBe(2);
        owner.dispose();
      }),
    );
  });

  test("releases failed reads and interrupts all sources on disposal", async () => {
    let reads = 0;
    let closed = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const finish = yield* Deferred.make<void>();
        const failure = new HostOperationError({ operation: "read", message: "Read failed" });
        const failingOwner = createClaudeTranscriptReadOwner({
          read: () => {
            reads += 1;
            return Deferred.await(finish).pipe(Effect.andThen(Effect.fail(failure)));
          },
        });
        const first = yield* Effect.forkChild(Effect.result(failingOwner.read(input)), {
          startImmediately: true,
        });
        const second = yield* Effect.forkChild(Effect.result(failingOwner.read(input)), {
          startImmediately: true,
        });
        yield* Deferred.succeed(finish, undefined);
        expect(yield* Fiber.join(first)).toMatchObject({ _tag: "Failure", failure });
        expect(yield* Fiber.join(second)).toMatchObject({ _tag: "Failure", failure });
        yield* Effect.result(failingOwner.read(input));
        expect(reads).toBe(2);
        failingOwner.dispose();

        const owner = createClaudeTranscriptReadOwner({
          read: () => Effect.never.pipe(Effect.ensuring(Effect.sync(() => void (closed += 1)))),
        });
        const waiting = yield* Effect.forkChild(owner.read(input), { startImmediately: true });
        const other = yield* Effect.forkChild(
          owner.read({ ...input, externalSessionId: "other" }),
          { startImmediately: true },
        );
        owner.dispose();
        expect(Exit.isFailure(yield* Fiber.await(waiting))).toBe(true);
        expect(Exit.isFailure(yield* Fiber.await(other))).toBe(true);
        expect(closed).toBe(2);
        expect(yield* Effect.result(owner.read(input))).toMatchObject({
          _tag: "Failure",
          failure: {
            operation: "claude.transcript.read",
            message: expect.stringContaining("closed"),
          },
        });
      }),
    );
  });
});
