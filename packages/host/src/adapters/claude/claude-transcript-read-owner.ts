import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { Deferred, Effect, Fiber } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type {
  ClaudeTranscriptReadFailure,
  ClaudeTranscriptReader,
  ClaudeTranscriptReadResult,
} from "./claude-transcript-reader";

type ReadEntry = {
  result: Deferred.Deferred<ClaudeTranscriptReadResult, ClaudeTranscriptReadFailure>;
  consumers: number;
  fiber: Deferred.Deferred<Fiber.Fiber<void>>;
};

export type ClaudeTranscriptReadOwner = ClaudeTranscriptReader & {
  dispose(): Effect.Effect<void>;
};

export const createClaudeTranscriptReadOwner = (
  source: ClaudeTranscriptReader,
): ClaudeTranscriptReadOwner => {
  const entries = new Map<string, ReadEntry>();
  const owned = new Set<ReadEntry>();
  let disposed = false;

  const release = (key: string, entry: ReadEntry): Effect.Effect<void> =>
    Effect.suspend(() => {
      entry.consumers -= 1;
      if (entry.consumers > 0 || entries.get(key) !== entry) return Effect.void;
      entries.delete(key);
      return Deferred.await(entry.fiber).pipe(Effect.flatMap(Fiber.interrupt), Effect.asVoid);
    });

  const read = (input: LoadAgentSessionHistoryInput) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (disposed)
          return yield* new HostOperationError({
            operation: "claude.transcript.read",
            message:
              "The Claude transcript reader is closed. Reload the runtime before reading this session.",
          });
        const key = JSON.stringify([
          input.repoPath,
          input.workingDirectory,
          input.externalSessionId,
        ]);
        let entry = entries.get(key);
        const created = entry === undefined;
        if (!entry) {
          entry = { result: Deferred.makeUnsafe(), consumers: 0, fiber: Deferred.makeUnsafe() };
          entries.set(key, entry);
          owned.add(entry);
        }
        entry.consumers += 1;
        const current = entry;
        if (created) {
          const work = source.read(input).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (entries.get(key) === current) entries.delete(key);
                owned.delete(current);
                Deferred.doneUnsafe(current.result, exit);
              }),
            ),
            Effect.ignore,
          );
          const fiber = yield* Effect.forkDetach(Effect.interruptible(work), {
            startImmediately: true,
          });
          yield* Deferred.succeed(current.fiber, fiber);
          if (disposed || entries.get(key) !== current) fiber.interruptUnsafe();
        }
        return yield* restore(Deferred.await(current.result)).pipe(
          Effect.ensuring(release(key, current)),
        );
      }),
    );

  return {
    read,
    dispose: () =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          disposed = true;
          entries.clear();
          yield* Effect.forEach(
            [...owned],
            (entry) => Deferred.await(entry.fiber).pipe(Effect.flatMap(Fiber.interrupt)),
            { concurrency: "unbounded", discard: true },
          );
        }),
      ),
  };
};
