/**
 * Parses a zoned ISO 8601 instant into epoch milliseconds without rounding its calendar fields.
 * `subMilliseconds` sets what happens to precision below one millisecond: `reject` fails, and
 * `truncate` drops it. Returns null for an invalid or out-of-range value.
 */
export const parseZonedIsoInstant = (
  value: string,
  subMilliseconds: "reject" | "truncate",
): number | null => {
  const match =
    /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
      value,
    );
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] =
    match;
  if (yearText === "-000000") return null;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? 0);
  if (subMilliseconds === "reject" && fraction.slice(3).replaceAll("0", "") !== "") return null;
  const millisecond = Number(fraction.slice(0, 3).padEnd(3, "0"));
  if (month < 1 || month > 12 || day < 1 || hour > 24 || minute > 59 || second > 59) return null;
  if (hour === 24 && (minute !== 0 || second !== 0 || millisecond !== 0)) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > (daysInMonth[month - 1] ?? 0)) return null;
  // Gregorian calendar arithmetic also admits offset dates at the JavaScript Date limits.
  const calendarYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(calendarYear / 400);
  const yearOfEra = calendarYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const days =
    era * 146097 +
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear -
    719468;
  let offset = 0;
  if (zone !== "Z") {
    const offsetText = zone?.slice(1).replace(":", "") ?? "";
    const offsetHours = Number(offsetText.slice(0, 2));
    const offsetMinutes = Number(offsetText.slice(2) || "0");
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    offset = (offsetHours * 60 + offsetMinutes) * (zone?.startsWith("-") ? -1 : 1);
  }
  const milliseconds =
    days * 86400000 + ((hour * 60 + minute - offset) * 60 + second) * 1000 + millisecond;
  if (!Number.isInteger(milliseconds) || Math.abs(milliseconds) > 8640000000000000) return null;
  return milliseconds;
};
