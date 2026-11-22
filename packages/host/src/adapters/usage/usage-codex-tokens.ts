import { z } from "zod";
import type { UsageTokens } from "../../domain/usage/usage-unit";

const count = z.number().int().nonnegative();

/** Codex reports input with cache reads and cache writes in it, and output with reasoning in it. */
export const codexRawUsageSchema = z.object({
  input_tokens: count,
  cached_input_tokens: count,
  // Cache writes exist from CLI 0.140. Earlier records have no such charge.
  cache_write_input_tokens: count.optional().catch(undefined),
  output_tokens: count,
  total_tokens: count.optional().catch(undefined),
});

/** One Codex usage measurement, as the runtime counts it. */
export const codexUsageSchema = z.object({
  input: count,
  cached: count,
  cacheWrite: count,
  output: count,
  total: count,
});
export type CodexUsage = z.infer<typeof codexUsageSchema>;

export const codexUsageOf = (
  value: z.infer<typeof codexRawUsageSchema> | undefined,
): CodexUsage | null =>
  value === undefined
    ? null
    : {
        input: value.input_tokens,
        cached: value.cached_input_tokens,
        cacheWrite: value.cache_write_input_tokens ?? 0,
        output: value.output_tokens,
        total: value.total_tokens ?? value.input_tokens + value.output_tokens,
      };

/** Splits the Codex input into new input, cache reads, and cache writes. */
export const codexTokensOf = (usage: CodexUsage): UsageTokens => {
  const cacheRead = Math.min(usage.cached, usage.input);
  const cacheWrite = Math.min(usage.cacheWrite, usage.input - cacheRead);
  return {
    input: usage.input - cacheRead - cacheWrite,
    cacheRead,
    cacheWrite5m: cacheWrite,
    cacheWrite1h: 0,
    output: usage.output,
  };
};

const sameCodexUsage = (left: CodexUsage, right: CodexUsage): boolean =>
  left.input === right.input &&
  left.cached === right.cached &&
  left.cacheWrite === right.cacheWrite &&
  left.output === right.output &&
  left.total === right.total;

/**
 * True for a cumulative snapshot of a new request. Codex repeats a snapshot, and writes one
 * without a request as a context estimate.
 */
export const isNewCodexSnapshot = (
  previous: CodexUsage | null,
  total: CodexUsage,
  last: CodexUsage,
): boolean =>
  (previous === null || !sameCodexUsage(previous, total)) && last.input + last.output > 0;
