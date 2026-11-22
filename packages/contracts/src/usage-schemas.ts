import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";

const count = z.number().int().nonnegative();

/**
 * The first and last dates that Usage reads. Agent history does not reach outside them, and the
 * bounds keep a report under 1,200 monthly periods.
 */
export const USAGE_FIRST_DATE = "2000-01-01";
export const USAGE_LAST_DATE = "2099-12-31";

/** A calendar date, `YYYY-MM-DD`, in the host time zone. */
const usageIsoDateSchema = z.iso.date();

const usageRangeDateSchema = usageIsoDateSchema.refine(
  (date) => date >= USAGE_FIRST_DATE && date <= USAGE_LAST_DATE,
  `Use a date from ${USAGE_FIRST_DATE} to ${USAGE_LAST_DATE}.`,
);

export const usageRangeInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("last_7_days") }),
  z.strictObject({ kind: z.literal("last_30_days") }),
  z.strictObject({ kind: z.literal("last_90_days") }),
  z.strictObject({ kind: z.literal("all_time") }),
  z
    .strictObject({
      kind: z.literal("custom"),
      start: usageRangeDateSchema,
      end: usageRangeDateSchema,
    })
    .refine((range) => range.start <= range.end, "The end date must not precede the start date."),
]);
export type UsageRangeInput = z.infer<typeof usageRangeInputSchema>;

export const usageReportReadInputSchema = z.strictObject({
  range: usageRangeInputSchema,
  /** `null` selects all runtimes. */
  runtime: runtimeKindSchema.nullable(),
});
export type UsageReportReadInput = z.infer<typeof usageReportReadInputSchema>;

const usageCostStateSchema = z.enum(["none", "complete", "partial", "unavailable"]);
export type UsageCostState = z.infer<typeof usageCostStateSchema>;

const usageFigureSchema = z.strictObject({
  tokens: z.strictObject({
    /** New input, without cache reads and cache writes. */
    input: count,
    cacheRead: count,
    cacheWrite: count,
    /** Includes reasoning tokens. */
    output: count,
    /** `input + cacheRead + cacheWrite + output`. */
    processed: count,
  }),
  /** Model requests without a full token measurement. They are always unpriced. */
  unmeasured: count,
  /** Distinct sessions with model activity. */
  sessions: count,
  /** False when a coverage issue of an included runtime overlaps the dates of this figure. */
  complete: z.boolean(),
  cost: z.strictObject({
    /** Estimated API cost of the priced usage only. */
    usd: z.number().nonnegative(),
    state: usageCostStateSchema,
    /** Processed tokens without a rate. */
    unpricedTokens: count,
  }),
});
export type UsageFigure = z.infer<typeof usageFigureSchema>;

const usageRuntimeFigureSchema = z.strictObject({
  runtime: runtimeKindSchema,
  figure: usageFigureSchema,
});

export const usageIssueCodeSchema = z.enum([
  "unreadable",
  "malformed_records",
  "unsupported_format",
]);

const usageCoverageIssueSchema = z.strictObject({
  code: usageIssueCodeSchema,
  /** Names the runtime and the kind of location. It never contains a path. */
  message: z.string().min(1),
  nextAction: z.string().min(1).nullable(),
});
export type UsageCoverageIssue = z.infer<typeof usageCoverageIssueSchema>;

const usageRuntimeCoverageSchema = z.strictObject({
  runtime: runtimeKindSchema,
  state: z.enum(["complete", "partial", "no_history"]),
  issues: z.array(usageCoverageIssueSchema),
});
export type UsageRuntimeCoverage = z.infer<typeof usageRuntimeCoverageSchema>;

export const usageGranularitySchema = z.enum(["day", "week", "month"]);
export type UsageGranularity = z.infer<typeof usageGranularitySchema>;

export const usageReportSchema = z.strictObject({
  /** IANA time zone of the host. */
  timeZone: z.string().min(1),
  range: z.strictObject({ start: usageIsoDateSchema, end: usageIsoDateSchema }),
  granularity: usageGranularitySchema,
  /** ISO instant of the source check of this read. */
  resultAt: z.iso.datetime({ offset: true }),
  /** The rate catalog of the costs: its source, when the host downloaded it, and any problem. */
  pricing: z.strictObject({
    source: z.string().min(1),
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
    issue: z.string().min(1).nullable(),
  }),
  totals: usageFigureSchema,
  periods: z.array(
    z.strictObject({
      start: usageIsoDateSchema,
      end: usageIsoDateSchema,
      runtimes: z.array(usageRuntimeFigureSchema),
    }),
  ),
  byRuntime: z.array(usageRuntimeFigureSchema),
  byModel: z.array(
    z.strictObject({
      id: z.string().min(1),
      provider: z.string().min(1).nullable(),
      model: z.string().min(1).nullable(),
      figure: usageFigureSchema,
    }),
  ),
  byProject: z.array(
    z.strictObject({
      id: z.string().min(1),
      label: z.string().min(1).nullable(),
      figure: usageFigureSchema,
    }),
  ),
  /** Coverage of the selected range, one entry per selected runtime. */
  coverage: z.array(usageRuntimeCoverageSchema),
});
export type UsageReport = z.infer<typeof usageReportSchema>;
export type UsagePeriod = UsageReport["periods"][number];

const progressCountSchema = z.number().int().nonnegative();

/**
 * The work of the usage index while it reads new history: for each runtime, the share of its
 * parse work and the sessions that it read out of the sessions to read. The host publishes it on
 * `openducktor://usage-index-progress` only while a read parses sources.
 */
export const usageIndexProgressSchema = z.strictObject({
  /** `reading` parses the sources; `summarizing` rolls them up into days. */
  phase: z.enum(["reading", "summarizing"]),
  startedAt: z.iso.datetime({ offset: true }),
  runtimes: z.array(
    z.strictObject({
      runtime: runtimeKindSchema,
      /** The share of the parse work, from 0 to 1. */
      progress: z.number().min(0).max(1),
      done: z.boolean(),
      /** Sessions whose history the read finished. `total` is null until the read knows it. */
      sessions: z.strictObject({
        done: progressCountSchema,
        total: progressCountSchema.nullable(),
      }),
    }),
  ),
});
export type UsageIndexProgress = z.infer<typeof usageIndexProgressSchema>;
