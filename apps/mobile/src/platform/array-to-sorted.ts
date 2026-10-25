/**
 * `Array.prototype.toSorted` for runtimes without it. The Hermes build of React Native 0.88 has
 * `toReversed` and `toSpliced` but no `toSorted`, and shared task and session code calls it.
 */
export const sortedCopy = <T>(source: ArrayLike<T>, compare?: (left: T, right: T) => number): T[] =>
  Array.from(source).sort(compare);

/** The method form that the app installs on `Array.prototype`. */
export function arrayToSorted<T>(this: ArrayLike<T>, compare?: (left: T, right: T) => number): T[] {
  return sortedCopy(this, compare);
}
