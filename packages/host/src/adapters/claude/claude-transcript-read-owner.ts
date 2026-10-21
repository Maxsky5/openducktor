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
  fiber?: Fiber.Fiber<void>;
};

export type ClaudeTranscriptReadOwner = ClaudeTranscriptReader & { dispose(): void };

export const createClaudeTranscriptReadOwner = (
  source: ClaudeTranscriptReader,
): ClaudeTranscriptReadOwner => {
  const entries = new Map<string, ReadEntry>();
  let disposed = false;

  const release = (key: string, entry: ReadEntry): Effect.Effect<void> =>
    Effect.suspend(() => {
      entry.consumers -= 1;
      if (entry.consumers > 0 || entries.get(key) !== entry) return Effect.void;
      entries.delete(key);
      return entry.fiber ? Fiber.interrupt(entry.fiber).pipe(Effect.asVoid) : Effect.void;
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
          entry = { result: Deferred.makeUnsafe(), consumers: 0 };
          entries.set(key, entry);
        }
        entry.consumers += 1;
        const current = entry;
        if (created) {
          const work = source.read(input).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (entries.get(key) === current) entries.delete(key);
                Deferred.doneUnsafe(current.result, exit);
              }),
            ),
            Effect.ignore,
          );
          current.fiber = yield* Effect.forkDetach(Effect.interruptible(work), {
            startImmediately: true,
          });
          if (disposed || entries.get(key) !== current) current.fiber.interruptUnsafe();
        }
        return yield* restore(Deferred.await(current.result)).pipe(
          Effect.ensuring(release(key, current)),
        );
      }),
    );

  return {
    read,
    dispose: () => {
      disposed = true;
      const pending = [...entries.values()];
      entries.clear();
      for (const entry of pending) entry.fiber?.interruptUnsafe();
    },
  };
};
