import type {
  RuntimeKind,
  UsageFigure,
  UsageGranularity,
  UsagePeriod,
  UsageReport,
} from "@openducktor/contracts";

export type UsageMetric = "tokens" | "cost";

/** Runtimes in a fixed order, so a runtime keeps its color and place in every view. */
export const USAGE_RUNTIMES: readonly RuntimeKind[] = [
  "claude",
  "codex",
  "opencode",
  "antigravity",
];

export const USAGE_RUNTIME_LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity",
} satisfies Record<RuntimeKind, string>;

export const USAGE_RUNTIME_COLORS = {
  claude: "var(--chart-runtime-claude)",
  codex: "var(--chart-runtime-codex)",
  opencode: "var(--chart-runtime-opencode)",
  antigravity: "var(--chart-runtime-antigravity)",
} satisfies Record<RuntimeKind, string>;

/** The words of a granularity: the name of one period, its adjective, and its title. */
export const PERIOD_TEXT = {
  day: { noun: "day", adjective: "Daily", label: "Day" },
  week: { noun: "week", adjective: "Weekly", label: "Week" },
  month: { noun: "month", adjective: "Monthly", label: "Month" },
} satisfies Record<UsageGranularity, { noun: string; adjective: string; label: string }>;

/**
 * The words of a metric: its tab and column label, its noun in a share, the title of its total,
 * and the name of its trend.
 */
export const METRIC_TEXT = {
  tokens: {
    label: "Tokens",
    noun: "tokens",
    headline: "Processed tokens",
    trend: "processed tokens",
  },
  cost: { label: "Cost", noun: "cost", headline: "Estimated API cost", trend: "estimated cost" },
} satisfies Record<UsageMetric, { label: string; noun: string; headline: string; trend: string }>;

const fullNumber = new Intl.NumberFormat("en-US");
// Three significant digits keep compact values short and as exact as a reader needs. A trailing
// zero stays, so `1.60B` lines up with `1.59B`.
const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  minimumSignificantDigits: 3,
  maximumSignificantDigits: 3,
});
/** Axis labels drop trailing zeros: `6B`, not `6.00B`. */
const axisNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});
const cents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compactDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 3,
});
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatCount = (value: number): string => fullNumber.format(value);

/** A count with its noun, such as `1 session` or `2 sessions`. */
export const formatCountOf = (value: number, noun: string): string =>
  `${formatCount(value)} ${value === 1 ? noun : `${noun}s`}`;

/** `59.8B`, `282M`, `4.6K`, or the whole count below 1,000. */
export const formatCompactCount = (value: number): string =>
  value < 1_000 ? fullNumber.format(value) : compactNumber.format(value);

/** A share with one decimal. A share that rounds to 0% or 100% shows as `<0.1%` or `>99.9%`. */
export const formatShare = (value: number): string => {
  if (value > 0 && value < 0.0005) return "<0.1%";
  if (value < 1 && value >= 0.9995) return ">99.9%";
  return percent.format(value);
};

/** Cents below $1,000. Above, cents add false precision to an estimate. */
export const formatUsd = (value: number): string => {
  if (value > 0 && value < 0.01) return "<$0.01";
  return value >= 1_000 ? dollars.format(value) : cents.format(value);
};

/** Cents in every table cell, so the decimals of a column line up. */
const formatUsdCents = (value: number): string =>
  value > 0 && value < 0.01 ? "<$0.01" : cents.format(value);

/** A short axis label of an amount. */
const formatAxisUsd = (value: number): string => {
  if (value === 0) return "$0";
  if (value >= 1_000) return compactDollars.format(value);
  return value >= 10 ? dollars.format(value) : cents.format(value);
};

export const formatMetric = (value: number, metric: UsageMetric): string =>
  metric === "cost" ? formatUsd(value) : formatCompactCount(value);

/** A value in a table cell: cents for amounts, so a column lines up. */
export const formatTableMetric = (value: number, metric: UsageMetric): string =>
  metric === "cost" ? formatUsdCents(value) : formatCompactCount(value);

export const formatAxisMetric = (value: number, metric: UsageMetric): string =>
  metric === "cost" ? formatAxisUsd(value) : axisNumber.format(value);

const PROVIDER_NAMES = new Map([
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
  ["google", "Google"],
  ["google-vertex", "Google Vertex"],
  ["amazon-bedrock", "Amazon Bedrock"],
  ["openrouter", "OpenRouter"],
  ["opencode-go", "OpenCode Go"],
  ["deepseek", "DeepSeek"],
  ["xai", "xAI"],
]);

/** The display name of a recorded provider ID, or the ID itself. */
export const providerName = (provider: string): string => PROVIDER_NAMES.get(provider) ?? provider;

/** True when the figure has requests but none of them has token counts. */
const onlyUnmeasured = (figure: UsageFigure): boolean =>
  figure.tokens.processed === 0 && figure.unmeasured > 0;

/** The value of a figure in a metric, or null when the metric has no value. */
export const metricValue = (figure: UsageFigure, metric: UsageMetric): number | null => {
  if (metric === "tokens") return onlyUnmeasured(figure) ? null : figure.tokens.processed;
  return figure.cost.state === "unavailable" ? null : figure.cost.usd;
};

/**
 * What a value can leave out: usage without a rate, requests without token counts, or history
 * that could not be read.
 */
export type FigureGap = "unpriced" | "uncounted" | "unread";

const GAP_ORDER: readonly FigureGap[] = ["unpriced", "uncounted", "unread"];

/**
 * The words of each gap. `short` is a line in a list. `long` explains a mark on a value that
 * leaves the gap out. `missing` explains a dash: a value that the gap removes completely.
 */
export const GAP_TEXT = {
  unpriced: {
    short: "Some usage has no rate",
    long: "This value leaves out usage without a published rate.",
    missing: "The rate catalog lists no rate for this usage.",
  },
  uncounted: {
    short: "Some requests have no token counts",
    long: "This value leaves out requests without token counts.",
    missing: "These requests have no token counts.",
  },
  unread: {
    short: "Some history could not be read",
    long: "Some history of this range could not be read, so this value can be higher.",
    missing: "Some history could not be read, so a zero is not confirmed.",
  },
} satisfies Record<FigureGap, { short: string; long: string; missing: string }>;

/** What the value of a figure in a metric leaves out, in a fixed order. */
export const figureGaps = (figure: UsageFigure, metric: UsageMetric): FigureGap[] => {
  const gaps: FigureGap[] = [];
  if (metric === "tokens") {
    if (figure.unmeasured > 0) gaps.push("uncounted");
  } else if (figure.cost.state === "partial") gaps.push("unpriced");
  else if (figure.cost.state === "unavailable")
    gaps.push(figure.cost.unpricedTokens === 0 ? "uncounted" : "unpriced");
  if (!figure.complete) gaps.push("unread");
  return gaps;
};

/** The gap that leaves a figure without a value to show, or null when it has one. */
const missingGap = (figure: UsageFigure, metric: UsageMetric): FigureGap | null => {
  const value = metricValue(figure, metric);
  if (value === null) return figureGaps(figure, metric)[0] ?? null;
  // Without full coverage, a zero cannot show that nothing happened.
  return !figure.complete && value === 0 ? "unread" : null;
};

/** The reason that a missing value gives, or null when the figure has a value. */
export const missingReason = (figure: UsageFigure, metric: UsageMetric): string | null => {
  const gap = missingGap(figure, metric);
  return gap === null ? null : GAP_TEXT[gap].missing;
};

/** The value to show, or null when the metric has none or coverage cannot confirm a zero. */
export const shownValue = (figure: UsageFigure, metric: UsageMetric): number | null =>
  missingGap(figure, metric) === null ? metricValue(figure, metric) : null;

/** The sentences of what a value leaves out, or null when it leaves out nothing. */
export const gapsNote = (gaps: readonly FigureGap[]): string | null =>
  gaps.length === 0 ? null : gaps.map((gap) => GAP_TEXT[gap].long).join(" ");

/** Explains a total of the known values, which leaves out what its gaps name. */
export const partialTotalText = (gaps: Iterable<FigureGap>): string => {
  const named = new Set(gaps);
  const lines = GAP_ORDER.filter((gap) => named.has(gap)).map((gap) => `${GAP_TEXT[gap].short}.`);
  return ["Total of the known values.", ...lines].join(" ");
};

/** The share of processed tokens without a published rate. */
const unpricedShareOf = (figure: UsageFigure): number =>
  figure.tokens.processed === 0 ? 0 : figure.cost.unpricedTokens / figure.tokens.processed;

/**
 * A short line with the amount that a shown value leaves out, or null when it leaves out nothing.
 * Unread history has its own mark.
 */
export const leftOutNote = (figure: UsageFigure, metric: UsageMetric): string | null => {
  if (shownValue(figure, metric) === null) return null;
  const [gap] = figureGaps(figure, metric);
  if (gap === "unpriced")
    return figure.cost.unpricedTokens > 0
      ? `${formatShare(unpricedShareOf(figure))} of tokens unpriced`
      : `${formatCountOf(figure.unmeasured, "request")} unpriced`;
  if (gap === "uncounted")
    return `${formatCountOf(figure.unmeasured, "request")} without token counts`;
  return null;
};

/**
 * The share of a total that the shown value of a figure makes up, or null when the value or the
 * total is missing or zero. An unconfirmed zero has no share.
 */
export const shareOf = (
  figure: UsageFigure,
  total: number | null,
  metric: UsageMetric,
): number | null => {
  const value = shownValue(figure, metric);
  return value === null || total === null || total === 0 ? null : value / total;
};

/** One runtime of a period: its figure, or null without usage, and the value to show. */
export type PeriodPart = { runtime: RuntimeKind; figure: UsageFigure | null; value: number | null };

/**
 * The total of a period over the runtimes: the sum of the shown values. The total is partial
 * when a value is missing or a figure has unread history, because the true total can then be
 * higher. `gaps` names what the values leave out.
 */
export type PeriodTotal = {
  value: number;
  partial: boolean;
  gaps: FigureGap[];
  parts: PeriodPart[];
};

/** The total of a period over the runtimes in a metric. */
export const periodTotal = (
  period: UsagePeriod,
  runtimes: readonly RuntimeKind[],
  metric: UsageMetric,
): PeriodTotal => {
  const figures = new Map(period.runtimes.map((entry) => [entry.runtime, entry.figure]));
  const gaps = new Set<FigureGap>();
  let value = 0;
  let partial = false;
  const parts = runtimes.map((runtime): PeriodPart => {
    const figure = figures.get(runtime);
    // A runtime without usage in the period has a confirmed zero.
    if (!figure) return { runtime, figure: null, value: 0 };
    const shown = shownValue(figure, metric);
    if (shown === null || !figure.complete) partial = true;
    value += shown ?? 0;
    for (const gap of figureGaps(figure, metric)) gaps.add(gap);
    return { runtime, figure, value: shown };
  });
  return { value, partial, gaps: GAP_ORDER.filter((gap) => gaps.has(gap)), parts };
};

/** A date at midnight UTC, so formats with the UTC zone show the calendar date itself. */
export const dateOf = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
};

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const formatDate = (isoDate: string): string => dayYearFormat.format(dateOf(isoDate));

export const formatRange = (start: string, end: string): string => {
  if (start === end) return formatDate(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? dayFormat.format(dateOf(start)) : formatDate(start)} – ${formatDate(end)}`;
};

/** A short axis label of a period start. */
export const formatAxisDate = (date: Date, granularity: UsageGranularity): string =>
  granularity === "month" ? monthFormat.format(date) : dayFormat.format(date);

/**
 * Label dates in equal steps back from the last period, plus the first period. The first period
 * takes the place of a label closer than half a step, so no two labels crowd.
 */
export const labelDates = (
  periods: readonly UsagePeriod[],
  count: number,
  granularity: UsageGranularity,
): Date[] => {
  const last = periods.length - 1;
  if (last < 0) return [];
  const even = Math.max(1, Math.ceil(last / Math.max(1, count - 1)));
  // Days step in whole weeks once a step passes a few days, so labels fall on one weekday.
  const step = granularity === "day" && even > 3 ? 7 * Math.max(1, Math.round(even / 7)) : even;
  const indexes: number[] = [];
  for (let index = last; index > 0; index -= step) indexes.unshift(index);
  if (indexes.length > 0 && (indexes[0] ?? 0) < step / 2) indexes.shift();
  indexes.unshift(0);
  return indexes.flatMap((index) => {
    const period = periods[index];
    return period ? [dateOf(period.start)] : [];
  });
};

/** The name of a period in tables and tooltips: `Nov 22`, `Nov 17 – Nov 23`, or `Nov 2026`. */
export const periodName = (
  period: { start: string; end: string },
  granularity: UsageGranularity,
): string => {
  if (granularity === "month") return monthFormat.format(dateOf(period.start));
  if (granularity === "week" && period.start !== period.end)
    return `${dayFormat.format(dateOf(period.start))} – ${dayFormat.format(dateOf(period.end))}`;
  return dayFormat.format(dateOf(period.start));
};

/**
 * True when the range ends on the day of the result in the host time zone: that day is still in
 * progress, so its value can grow.
 */
export const endsToday = (report: UsageReport): boolean => {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: report.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(report.resultAt));
  return localDate === report.range.end;
};

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const formatTime = (instant: string): string => timeFormat.format(new Date(instant));

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A local date and time, such as "Nov 22, 11:20 AM". */
export const formatDateTime = (instant: string): string => dateTimeFormat.format(new Date(instant));

/** The runtimes of a report, in series order. */
export const reportRuntimes = (byRuntime: UsageReport["byRuntime"]): RuntimeKind[] =>
  USAGE_RUNTIMES.filter((runtime) => byRuntime.some((row) => row.runtime === runtime));
