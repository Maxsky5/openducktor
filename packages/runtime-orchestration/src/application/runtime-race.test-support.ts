import { Context, Effect, Scheduler } from "effect";

const YIELD_INTERVAL = 64;
const context = Context.make(Scheduler.MaxOpsBeforeYield, YIELD_INTERVAL);

export const yieldOffsets = Array.from({ length: YIELD_INTERVAL }, (_, offset) => offset);

/** Moves the first scheduler yield through the action without using Effect's large default budget. */
export const forkAtYieldOffset = <A, E>(offset: number, action: Effect.Effect<A, E>) => {
  let prelude: Effect.Effect<void> = Effect.void;
  for (let step = 0; step < offset; step += 1) prelude = prelude.pipe(Effect.andThen(Effect.void));
  return Effect.runForkWith(context)(prelude.pipe(Effect.andThen(action)));
};
