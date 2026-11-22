import type { UsageCostState, UsageFigure } from "@openducktor/contracts";

/** Summed rollup values of one group. Sessions are distinct inside the group. */
export type UsageSums = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  unmeasured: number;
  unpricedTokens: number;
  costUsd: number;
  sessions: number;
};

export const EMPTY_USAGE_SUMS: UsageSums = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  unmeasured: 0,
  unpricedTokens: 0,
  costUsd: 0,
  sessions: 0,
};

/** Adds two groups. Sessions add because session names never repeat across runtimes. */
export const addUsageSums = (left: UsageSums, right: UsageSums): UsageSums => ({
  input: left.input + right.input,
  cacheRead: left.cacheRead + right.cacheRead,
  cacheWrite: left.cacheWrite + right.cacheWrite,
  output: left.output + right.output,
  unmeasured: left.unmeasured + right.unmeasured,
  unpricedTokens: left.unpricedTokens + right.unpricedTokens,
  costUsd: left.costUsd + right.costUsd,
  sessions: left.sessions + right.sessions,
});

const costState = (processed: number, sums: UsageSums): UsageCostState => {
  if (processed === 0 && sums.unmeasured === 0) return "none";
  const priced = processed - sums.unpricedTokens;
  if (sums.unpricedTokens === 0 && sums.unmeasured === 0) return "complete";
  return priced > 0 ? "partial" : "unavailable";
};

export const usageFigure = (sums: UsageSums, complete: boolean): UsageFigure => {
  const processed = sums.input + sums.cacheRead + sums.cacheWrite + sums.output;
  return {
    tokens: {
      input: sums.input,
      cacheRead: sums.cacheRead,
      cacheWrite: sums.cacheWrite,
      output: sums.output,
      processed,
    },
    unmeasured: sums.unmeasured,
    sessions: sums.sessions,
    complete,
    cost: {
      // Rounds away floating point noise below one millionth of a dollar.
      usd: Math.round(sums.costUsd * 1e6) / 1e6,
      state: costState(processed, sums),
      unpricedTokens: sums.unpricedTokens,
    },
  };
};
