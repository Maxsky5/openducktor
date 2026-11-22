import type { RuntimeKind, UsageGranularity, UsageRangeInput } from "@openducktor/contracts";

/** A calendar date, `YYYY-MM-DD`. */
export type UsageDate = string;

const DAY_MS = 86_400_000;
// Every time zone offset is a multiple of 15 minutes, so one local date covers each slot.
/** The calendar resolves dates in slots of this size; the index rolls up removed units by slot. */
export const USAGE_SLOT_MS = 15 * 60_000;

const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

const dateFromUtcParts = (year: number, month: number, day: number): UsageDate =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** `Date.UTC` maps years 0 to 99 to 1900 to 1999, so the year is set apart. */
const utcMsOfDate = (date: UsageDate): number => {
  const value = new Date(0);
  value.setUTCFullYear(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return value.getTime();
};

const dateOfUtcMs = (ms: number): UsageDate => {
  const value = new Date(ms);
  return dateFromUtcParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
};

export const addDays = (date: UsageDate, days: number): UsageDate =>
  dateOfUtcMs(utcMsOfDate(date) + days * DAY_MS);

/** Whole days from `start` to `end`. */
const daysBetween = (start: UsageDate, end: UsageDate): number =>
  Math.round((utcMsOfDate(end) - utcMsOfDate(start)) / DAY_MS);

/** Converts instants to calendar dates and back in one IANA time zone. */
export type UsageCalendar = {
  readonly timeZone: string;
  dateOf(ms: number): UsageDate;
  /** The first instant of a date. */
  startOf(date: UsageDate): number;
};

export const createUsageCalendar = (timeZone: string): UsageCalendar => {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const fields = (ms: number) => {
    const value = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
    for (const part of format.formatToParts(ms)) {
      const number = Number(part.value);
      if (part.type === "year") value.year = number;
      else if (part.type === "month") value.month = number;
      else if (part.type === "day") value.day = number;
      else if (part.type === "hour") value.hour = number;
      else if (part.type === "minute") value.minute = number;
      else if (part.type === "second") value.second = number;
    }
    return value;
  };
  const offsetMs = (ms: number): number => {
    const value = fields(ms);
    const local = Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
      value.second,
    );
    return local - Math.floor(ms / 1000) * 1000;
  };
  const dates = new Map<number, UsageDate>();
  const calendar: UsageCalendar = {
    timeZone,
    dateOf: (ms) => {
      const slot = Math.floor(ms / USAGE_SLOT_MS);
      let date = dates.get(slot);
      if (date === undefined) {
        const value = fields(slot * USAGE_SLOT_MS);
        date = dateFromUtcParts(value.year, value.month, value.day);
        if (dates.size > 100_000) dates.clear();
        dates.set(slot, date);
      }
      return date;
    },
    startOf: (date) => {
      const midnight = utcMsOfDate(date);
      const guess = midnight - offsetMs(midnight);
      // A second pass applies the offset at the guessed instant, which differs across a change.
      let start = midnight - offsetMs(guess);
      // Where a daylight saving change skips local midnight, the date starts later.
      while (calendar.dateOf(start) < date) start += USAGE_SLOT_MS;
      return start;
    },
  };
  return calendar;
};

export type UsagePeriodBounds = { start: UsageDate; end: UsageDate };

/** A recent range ends today and counts today. */
const RECENT_RANGE_DAYS = { last_7_days: 7, last_30_days: 30, last_90_days: 90 } as const;

/** The dates that a range selection reads. A null start reads all history. */
export const usageReadRange = (range: UsageRangeInput, today: UsageDate) => {
  if (range.kind === "custom") return { start: range.start, end: range.end };
  if (range.kind === "all_time") return { start: null, end: today };
  return { start: addDays(today, 1 - RECENT_RANGE_DAYS[range.kind]), end: today };
};

/** Days up to 92 days, ISO weeks up to 371 days, and calendar months for longer ranges. */
export const usageGranularity = (start: UsageDate, end: UsageDate): UsageGranularity => {
  const days = daysBetween(start, end) + 1;
  if (days <= 92) return "day";
  if (days <= 371) return "week";
  return "month";
};

const periodStart = (date: UsageDate, granularity: UsageGranularity): UsageDate => {
  if (granularity === "day") return date;
  if (granularity === "month") return `${date.slice(0, 7)}-01`;
  const weekday = new Date(utcMsOfDate(date)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
};

const nextPeriodStart = (start: UsageDate, granularity: UsageGranularity): UsageDate => {
  if (granularity === "day") return addDays(start, 1);
  if (granularity === "week") return addDays(start, 7);
  const value = new Date(utcMsOfDate(start));
  return dateFromUtcParts(
    value.getUTCMonth() === 11 ? value.getUTCFullYear() + 1 : value.getUTCFullYear(),
    value.getUTCMonth() === 11 ? 1 : value.getUTCMonth() + 2,
    1,
  );
};

/** The periods of a range. The first and last periods are clipped to the range. */
export const usagePeriods = (
  start: UsageDate,
  end: UsageDate,
  granularity: UsageGranularity,
): UsagePeriodBounds[] => {
  const periods: UsagePeriodBounds[] = [];
  let current = periodStart(start, granularity);
  while (current <= end) {
    const next = nextPeriodStart(current, granularity);
    const last = addDays(next, -1);
    periods.push({ start: current < start ? start : current, end: last > end ? end : last });
    current = next;
  }
  return periods;
};

/** `All time` starts at the earliest activity of the runtimes, or at its end without activity. */
const firstActivityDate = (
  earliest: Partial<Record<RuntimeKind, UsageDate>>,
  runtimes: readonly RuntimeKind[],
  end: UsageDate,
): UsageDate => {
  const first = runtimes.flatMap((runtime) => earliest[runtime] ?? []).sort()[0];
  return first !== undefined && first < end ? first : end;
};

/**
 * The dates, granularity, and periods of a report. A range without a start starts at the
 * earliest activity of its runtimes in `earliest`.
 */
export const usageReportPeriods = (
  range: { start: UsageDate | null; end: UsageDate },
  earliest: Partial<Record<RuntimeKind, UsageDate>>,
  runtimes: readonly RuntimeKind[],
) => {
  const start = range.start ?? firstActivityDate(earliest, runtimes, range.end);
  const granularity = usageGranularity(start, range.end);
  return {
    range: { start, end: range.end },
    granularity,
    periods: usagePeriods(start, range.end, granularity),
  };
};
