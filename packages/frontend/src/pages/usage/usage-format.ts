import type {
  RuntimeKind,
  UsageFigure,
  UsageGranularity,
  UsageReport,
} from "@openducktor/contracts";

export type UsageMetric = "tokens" | "cost";

/** Runtimes in a fixed order, so a runtime keeps its color and place in every view. */
export const USAGE_RUNTIMES: readonly RuntimeKind[] = ["claude", "codex", "opencode"];

export const USAGE_RUNTIME_LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
} satisfies Record<RuntimeKind, string>;

export const USAGE_RUNTIME_COLORS = {
  claude: "var(--chart-runtime-claude)",
  codex: "var(--chart-runtime-codex)",
  opencode: "var(--chart-runtime-opencode)",
} satisfies Record<RuntimeKind, string>;

/** The name of one period of a granularity, such as `day`. */
export const PERIOD_NOUNS = {
  day: "day",
  week: "week",
  month: "month",
} satisfies Record<UsageGranularity, string>;

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
export const formatUsdCents = (value: number): string =>
  value > 0 && value < 0.01 ? "<$0.01" : cents.format(value);

/** A short axis label of an amount. */
export const formatAxisUsd = (value: number): string => {
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

type MissingMetric = "unpriced" | "no_counts" | "unknown";

/** Why a figure has no value to show, or null when it has one. */
export const missingMetric = (figure: UsageFigure, metric: UsageMetric): MissingMetric | null => {
  if (metric === "cost" && figure.cost.state === "unavailable")
    return figure.cost.unpricedTokens === 0 ? "no_counts" : "unpriced";
  if (metric === "tokens" && onlyUnmeasured(figure)) return "no_counts";
  // Without full coverage, a zero cannot show that nothing happened.
  if (!figure.complete && metricValue(figure, metric) === 0) return "unknown";
  return null;
};

const MISSING_REASONS = {
  unpriced: "The rate catalog lists no rate for this usage.",
  no_counts: "These requests have no token counts.",
  unknown: "Some history could not be read, so a zero is not confirmed.",
} satisfies Record<MissingMetric, string>;

/** The reason that a missing value gives, or null when the figure has a value. */
export const missingReason = (figure: UsageFigure, metric: UsageMetric): string | null => {
  const missing = missingMetric(figure, metric);
  return missing === null ? null : MISSING_REASONS[missing];
};

/** The value to show, or null when the metric has none or coverage cannot confirm a zero. */
export const shownValue = (figure: UsageFigure, metric: UsageMetric): number | null =>
  missingMetric(figure, metric) === null ? metricValue(figure, metric) : null;

/** The share of processed tokens without a published rate. */
export const unpricedShareOf = (figure: UsageFigure): number =>
  figure.tokens.processed === 0 ? 0 : figure.cost.unpricedTokens / figure.tokens.processed;

/** A short note of what a value leaves out, or null when it leaves out nothing. */
export const leftOutNote = (figure: UsageFigure, metric: UsageMetric): string | null => {
  if (metric === "cost" && figure.cost.state === "partial")
    return figure.cost.unpricedTokens > 0
      ? `${formatShare(unpricedShareOf(figure))} of tokens unpriced`
      : `${formatCountOf(figure.unmeasured, "request")} unpriced`;
  if (metric === "tokens" && figure.unmeasured > 0 && figure.tokens.processed > 0)
    return `${formatCountOf(figure.unmeasured, "request")} without token counts`;
  return null;
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
