/**
 * The milliseconds of a CSS time value, such as `300ms` or `.3s`. A production build minifies
 * `300ms` to `.3s`, so a read of a custom property must accept both units.
 */
export const cssTimeMs = (value: string): number => {
  const time = value.trim();
  return Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000);
};
