import type { GitReadContext } from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import type { GitPortError } from "../../ports/git-port";

// Each capture shares one logical read, including its typed failure. New IDs always read again.
export const createGitReadCapture = <A>() => {
  type Capture = { expires: number; settled: boolean; read: Effect.Effect<A, GitPortError> };
  const reads = new Map<string, Capture>();
  const prune = (now: number) => {
    for (const [key, entry] of reads)
      if (entry.settled && (entry.expires <= now || reads.size > 128)) reads.delete(key);
  };
  const capture = (
    identity: string,
    context: GitReadContext | undefined,
    read: Effect.Effect<A, GitPortError>,
  ) =>
    Effect.gen(function* () {
      if (!context) return yield* read;
      const now = yield* Clock.currentTimeMillis;
      const key = JSON.stringify([identity, context.refreshId]);
      prune(now);
      const existing = reads.get(key);
      if (existing) return yield* existing.read;
      // Allocate before yielding so concurrent consumers reserve the same read.
      const entry: Capture = { expires: now + 60_000, settled: false, read };
      entry.read = Effect.runSync(
        Effect.cached(
          read.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                entry.settled = true;
                prune(now);
              }),
            ),
          ),
        ),
      );
      reads.set(key, entry);
      prune(now);
      return yield* entry.read;
    });
  return Object.assign(capture, { clear: () => reads.clear() });
};
