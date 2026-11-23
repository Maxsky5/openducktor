import path from "node:path";
import { Cause, Effect, Exit } from "effect";
import { z } from "zod";
import { HostOperationError } from "../../effect/host-errors";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import { CLAUDE_USAGE_LINE_FILTER, claudeUsageUnits } from "./usage-claude-records";
import {
  type CodexRolloutParser,
  codexParserStateSchema,
  createCodexRolloutParser,
  initialCodexParserState,
} from "./usage-codex-records";
import type { UsageSourceIssue } from "../../domain/usage/usage-report";
import { CODEX_USAGE_LINE_FILTER } from "./usage-codex-lines";
import { canResumeJsonl, readJsonlLines } from "./usage-jsonl-reader";
import { readAntigravityUsage } from "./usage-antigravity-reader";
import { openCodeParserStateSchema, readOpenCodeUsage } from "./usage-opencode-reader";
import type {
  OpenCodeProgress,
  UsageParseJob,
  UsageParseResult,
  UsageResumePoint,
} from "./usage-worker-protocol";

/** Tracks malformed lines and the dates of the requests around them. */
const createMalformedTracker = () => {
  let lastValidMs: number | null = null;
  let firstAtMs: number | null | undefined;
  let lastAtMs: number | null = null;
  let pending = false;
  return {
    malformed: () => {
      if (firstAtMs === undefined) firstAtMs = lastValidMs;
      pending = true;
    },
    valid: (occurredAtMs: number) => {
      if (pending) {
        lastAtMs = occurredAtMs;
        pending = false;
      }
      lastValidMs = occurredAtMs;
    },
    issue: (): UsageSourceIssue | null => {
      if (firstAtMs === undefined) return null;
      // Without a request after the last malformed line, its date is unknown.
      return { code: "malformed_records", firstAtMs, lastAtMs: pending ? null : lastAtMs };
    },
  };
};

type Continuation = { resume: UsageResumePoint | null; parserState: string | null };
const FROM_START: Continuation = { resume: null, parserState: null };

/** What a read can continue of the last read of the same file. */
const continuationOf = ({ format, fingerprint, previous }: UsageParseJob): Continuation => {
  // Another file at the same path starts again from nothing.
  if (previous === null || previous.fingerprint.fileId !== fingerprint.fileId) return FROM_START;
  // A database read compares its rows with the state of the last read.
  if (format === "opencode") return { resume: null, parserState: previous.parserState };
  // A conversation database is small, so a change reads it again.
  if (format === "antigravity") return FROM_START;
  // A compressed rollout never grows. A source that the host could not read starts again from
  // its first line, so issues of its earlier bytes come back.
  const grew =
    format === "jsonl" &&
    !previous.unreadable &&
    fingerprint.size > previous.fingerprint.size &&
    previous.resume !== null;
  return grew ? { resume: previous.resume, parserState: previous.parserState } : FROM_START;
};

const parseJsonl = async (
  job: UsageParseJob,
  continuation: Continuation,
): Promise<UsageParseResult> => {
  const compressed = job.format === "jsonl_zst";
  const planned = continuation.resume;
  // The bytes before the resume point must be the ones that the last read saw.
  const resume = planned !== null && (await canResumeJsonl(job.path, planned)) ? planned : null;
  const units: UsageUnit[] = [];
  const tracker = createMalformedTracker();
  const codex: CodexRolloutParser | null =
    job.runtime !== "codex"
      ? null
      : createCodexRolloutParser(
          resume !== null && continuation.parserState !== null
            ? codexParserStateSchema.parse(JSON.parse(continuation.parserState))
            : initialCodexParserState(),
        );
  // A line that is not JSON, or a usage record in an unknown shape, leaves the figures short.
  const collect = (found: UsageUnit[] | null) => {
    if (found === null) {
      tracker.malformed();
      return;
    }
    for (const unit of found) {
      tracker.valid(unit.occurredAtMs);
      units.push(unit);
    }
  };
  const nextResume = await readJsonlLines(
    job.path,
    {
      offset: resume?.offset ?? 0,
      compressed,
      filter: codex ? CODEX_USAGE_LINE_FILTER : CLAUDE_USAGE_LINE_FILTER,
    },
    (line) => {
      let found: UsageUnit[] | null;
      try {
        found = codex ? codex.line(line) : claudeUsageUnits(line.toString("utf8"));
      } catch (cause) {
        // Only a line that is not JSON is malformed. Other failures are bugs and stop the read.
        if (!(cause instanceof SyntaxError)) throw cause;
        found = null;
      }
      collect(found);
    },
  );
  const finished = codex?.finish() ?? { units: [], provisional: false };
  collect(finished.units);
  return {
    mode: resume ? "append" : "replace",
    units,
    // A provisional request can get its counts later, so the next read starts again from the
    // first line and replaces it.
    resume: finished.provisional ? null : nextResume,
    parserState: codex ? JSON.stringify(codex.state) : null,
    issue: tracker.issue(),
  };
};

const parseOpenCode = async (
  job: UsageParseJob,
  continuation: Continuation,
  onProgress: (progress: OpenCodeProgress) => void,
): Promise<UsageParseResult> => {
  const { parserState } = continuation;
  const previous =
    parserState === null ? null : openCodeParserStateSchema.parse(JSON.parse(parserState));
  const exit = await Effect.runPromiseExit(readOpenCodeUsage(job.path, previous, onProgress));
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  const read = exit.value;
  if (read.kind === "unsupported") {
    // Earlier units stay. A newer OpenDucktor can read the new format.
    return {
      mode: "append",
      units: [],
      resume: null,
      parserState,
      issue: { code: "unsupported_format", firstAtMs: null, lastAtMs: null },
    };
  }
  return {
    mode: read.mode,
    units: read.units,
    resume: null,
    parserState: JSON.stringify(read.state),
    issue: null,
  };
};

const parseAntigravity = async (job: UsageParseJob): Promise<UsageParseResult> => {
  const id = path.basename(job.path, ".db");
  const exit = await Effect.runPromiseExit(readAntigravityUsage(job.path, id));
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  const read = exit.value;
  if (read.kind === "unsupported")
    return {
      mode: "replace",
      units: [],
      resume: null,
      parserState: null,
      issue: { code: "unsupported_format", firstAtMs: null, lastAtMs: null },
    };
  const times = read.units.map((unit) => unit.occurredAtMs);
  return {
    mode: "replace",
    units: read.units,
    resume: null,
    parserState: null,
    // A call that the reader cannot decode leaves the figures of the conversation short.
    issue:
      read.malformed === 0
        ? null
        : {
            code: "malformed_records",
            firstAtMs: times.length > 0 ? Math.min(...times) : null,
            lastAtMs: times.length > 0 ? Math.max(...times) : null,
          },
  };
};

/** File system and decoder errors carry a code. SQLite errors come from the driver. */
const sourceReadErrorSchema = z.object({ code: z.string().min(1) });
const isSourceReadError = (cause: Error): boolean =>
  cause instanceof HostOperationError || sourceReadErrorSchema.safeParse(cause).success;

/**
 * Parses one source. It continues the last read when the source only grew, and reads it again
 * from its start otherwise. A source that the host cannot read keeps its earlier units and
 * reports why. Any other failure is a fault of the parser and rejects.
 */
export const parseUsageSource = async (
  job: UsageParseJob,
  /** Gets the progress inside a database source. A file source reports only its result. */
  onProgress: (progress: OpenCodeProgress) => void = () => {},
): Promise<UsageParseResult> => {
  const continuation = continuationOf(job);
  try {
    if (job.format === "opencode") return await parseOpenCode(job, continuation, onProgress);
    if (job.format === "antigravity") return await parseAntigravity(job);
    return await parseJsonl(job, continuation);
  } catch (cause) {
    if (!(cause instanceof Error) || !isSourceReadError(cause)) throw cause;
    return {
      mode: "append",
      units: [],
      resume: continuation.resume,
      parserState: continuation.parserState,
      issue: { code: "unreadable", firstAtMs: null, lastAtMs: null },
    };
  }
};
