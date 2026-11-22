/** The token counts of one model request, as the runtime reported them. */
export type UsageTokens = {
  /** New input, without cache reads and cache writes. */
  input: number;
  cacheRead: number;
  /** Cache writes with a 5-minute lifetime, and writes without a known lifetime. */
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** Includes reasoning tokens. */
  output: number;
};

/** One model request in the history of a runtime. */
export type UsageUnit = {
  /** The request identity inside its runtime. Copies of one request share it. */
  identity: string;
  occurredAtMs: number;
  /** The root session. Child sessions count under their root. */
  session: string;
  provider: string | null;
  model: string | null;
  /** The recorded working folder. */
  project: string | null;
  serviceTier: string | null;
  /** Null when the runtime did not report a full measurement. */
  tokens: UsageTokens | null;
};
