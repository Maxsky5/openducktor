import type { UsageUnit } from "../../domain/usage/usage-unit";

/**
 * The model output that starts one response: the evidence of a request that Codex may never
 * measure.
 */
export type CodexResponseStart = {
  atMs: number;
  /** The bytes of the first output item. They are decoded only when no record covers it. */
  line: Buffer;
  turnId: string;
  /** The number of the response in its turn. */
  index: number;
  /** The model, provider, project, and tier when the output came. Later settings never move it. */
  attribution: Omit<UsageUnit, "identity" | "occurredAtMs" | "session" | "tokens">;
  /** True when the output came after a copy of another thread's history without a known end. */
  copied: boolean;
};

/**
 * The response run that waits for a usage record. `open` takes more output of the same
 * response. `answered` means the model read input after it, so the next output starts a new
 * response.
 */
type RunState =
  | { kind: "idle" }
  | { kind: "open"; start: CodexResponseStart }
  | { kind: "answered"; start: CodexResponseStart };

/**
 * Tracks the responses of one rollout that no usage record covers.
 *
 * Codex writes no usage record for a response without token counts, such as an interrupted
 * response, but it keeps the response items. One run of model output is one response, until the
 * model reads input again. A usage record covers the run before it. A run that nothing covers by
 * the next run, the end of its turn, or the end of the read becomes one unmeasured request at its
 * first output.
 *
 * This diagram shows the states of one run.
 *
 * ```text
 * idle --output--> open --input--> answered --output--> (emit) open
 * open|answered --record--> idle
 * open|answered --end of turn or read--> (emit) idle
 * ```
 */
export const createCodexResponseTracker = (sessionOf: () => string | null) => {
  let run: RunState = { kind: "idle" };

  /**
   * Ends the waiting run. Returns its unmeasured request, or null when its first item is
   * malformed or can be a copy of another thread's output.
   */
  const end = (): UsageUnit[] | null => {
    const waiting = run;
    run = { kind: "idle" };
    const session = sessionOf();
    if (waiting.kind === "idle" || session === null) return [];
    const { start } = waiting;
    if (start.copied) return null;
    try {
      JSON.parse(start.line.toString("utf8"));
    } catch (cause) {
      // A rollout that resumes after a crash can end a cut line with a line feed.
      if (cause instanceof SyntaxError) return null;
      throw cause;
    }
    return [
      {
        ...start.attribution,
        occurredAtMs: start.atMs,
        session,
        identity: `turn:${start.turnId}:${start.index}`,
        tokens: null,
      },
    ];
  };

  return {
    /** True when the next model output belongs to the waiting run. */
    continuesRun: (): boolean => run.kind === "open",

    /**
     * Model output. It starts a response unless a run is open, and a run that the model
     * answered before ends without a record.
     */
    output: (start: CodexResponseStart): UsageUnit[] | null => {
      if (run.kind === "open") return [];
      const ended = run.kind === "answered" ? end() : [];
      run = { kind: "open", start };
      return ended;
    },

    /** The model read input, so the waiting run is complete. */
    input: (): void => {
      if (run.kind === "open") run = { kind: "answered", start: run.start };
    },

    /** A usage record or a new snapshot measured the waiting run. */
    covered: (): void => {
      run = { kind: "idle" };
    },

    end,

    /** True while a run waits for its record. */
    waiting: (): boolean => run.kind !== "idle",
  };
};
