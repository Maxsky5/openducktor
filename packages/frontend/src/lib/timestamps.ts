/** The later of two times in epoch milliseconds. Null means that the time is unknown. */
export const laterTime = (left: number | null, right: number | null): number | null => {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
};

/** Epoch milliseconds of a timestamp, or null when the value does not parse. */
export const parseTimestamp = (value: string): number | null => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};
