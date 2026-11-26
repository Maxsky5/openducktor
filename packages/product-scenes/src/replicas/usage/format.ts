// The words and the number formats of the Usage page, from usage-format.ts in
// packages/frontend/src/pages/usage. src/copied-usage.test.ts compares them with the app.
import type { RuntimeKind } from "../../sample/models";

export type UsageMetric = "tokens" | "cost";

export const USAGE_RUNTIME_LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity",
} as const satisfies Record<RuntimeKind, string>;

/** The words of the daily granularity, the only one that the scene shows. */
export const DAY_TEXT = { noun: "day", adjective: "Daily", label: "Day" } as const;

/** The tab label, the noun in a share, the title of the total, and the trend of each metric. */
export const METRIC_TEXT = {
  tokens: {
    label: "Tokens",
    noun: "tokens",
    headline: "Processed tokens",
    trend: "processed tokens",
  },
  cost: { label: "Cost", noun: "cost", headline: "Estimated API cost", trend: "estimated cost" },
} as const satisfies Record<UsageMetric, Record<"label" | "noun" | "headline" | "trend", string>>;

/**
 * A formatter that is built at its first use. The website loads this module with the timelines of
 * every scene, so a page that formats no usage builds no formatter.
 */
function lazy<Format>(build: () => Format): () => Format {
  let format: Format | undefined;
  return () => {
    format ??= build();
    return format;
  };
}

const fullNumber = lazy(() => new Intl.NumberFormat("en-US"));
const compactNumber = lazy(
  () =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
    }),
);
const axisNumber = lazy(
  () =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumSignificantDigits: 3,
    }),
);
const cents = lazy(
  () =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
);
const dollars = lazy(
  () =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }),
);
const compactDollars = lazy(
  () =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumSignificantDigits: 3,
    }),
);
const percent = lazy(
  () =>
    new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
);

export const formatCount = (value: number): string => fullNumber().format(value);

/** A count with its noun, such as `1 session` or `2 sessions`. */
export const formatCountOf = (value: number, noun: string): string =>
  `${formatCount(value)} ${value === 1 ? noun : `${noun}s`}`;

/** `1.84B`, `527M`, `4.6K`, or the whole count below 1,000. */
export const formatCompactCount = (value: number): string =>
  value < 1_000 ? fullNumber().format(value) : compactNumber().format(value);

/** A share with one decimal. A share that rounds to 0% or 100% shows as `<0.1%` or `>99.9%`. */
export const formatShare = (value: number): string => {
  if (value > 0 && value < 0.0005) return "<0.1%";
  if (value < 1 && value >= 0.9995) return ">99.9%";
  return percent().format(value);
};

/** Cents below $1,000, whole dollars above. */
export const formatUsd = (value: number): string => {
  if (value > 0 && value < 0.01) return "<$0.01";
  return value >= 1_000 ? dollars().format(value) : cents().format(value);
};

const formatAxisUsd = (value: number): string => {
  if (value === 0) return "$0";
  if (value >= 1_000) return compactDollars().format(value);
  return value >= 10 ? dollars().format(value) : cents().format(value);
};

export const formatMetric = (value: number, metric: UsageMetric): string =>
  metric === "cost" ? formatUsd(value) : formatCompactCount(value);

export const formatAxisMetric = (value: number, metric: UsageMetric): string =>
  metric === "cost" ? formatAxisUsd(value) : axisNumber().format(value);

/** A date at midnight UTC, so the formats show the calendar date itself. */
export const dateOf = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
};

const dayFormat = lazy(
  () =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
);
const dayYearFormat = lazy(
  () =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
);

const formatDate = (isoDate: string): string => dayYearFormat().format(dateOf(isoDate));

/** `Oct 28 – Nov 26, 2026`. */
export const formatRange = (start: string, end: string): string => {
  if (start === end) return formatDate(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? dayFormat().format(dateOf(start)) : formatDate(start)} – ${formatDate(end)}`;
};

/** The name of a day in the axis, the tooltip, and the Busiest day tile: `Nov 18`. */
export const formatDay = (date: Date): string => dayFormat().format(date);

/**
 * The indexes of the label dates of the x axis: equal steps back from the last day, in whole
 * weeks, plus the first day. The first day takes the place of a label closer than half a step.
 */
export const labelIndexes = (days: number, count: number): number[] => {
  const last = days - 1;
  if (last < 0) return [];
  const even = Math.max(1, Math.ceil(last / Math.max(1, count - 1)));
  const step = even > 3 ? 7 * Math.max(1, Math.round(even / 7)) : even;
  const indexes: number[] = [];
  for (let index = last; index > 0; index -= step) indexes.unshift(index);
  if (indexes.length > 0 && (indexes[0] ?? 0) < step / 2) indexes.shift();
  indexes.unshift(0);
  return indexes;
};

/** The number of date labels that fit a plot of a width, as the chart of the app counts them. */
export const labelCountFor = (width: number): number =>
  width < 360 ? 3 : width < 560 ? 4 : width < 800 ? 5 : 7;
