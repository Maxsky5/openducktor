/** Epoch milliseconds of a timestamp, or null when the value does not parse. */
export const parseTimestamp = (value: string): number | null => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};
