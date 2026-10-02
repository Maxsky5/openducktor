/** Compares two arrays item by item. Items cannot be `undefined`, so a missing item means a shorter array. */
export const arraysEqual = <T extends NonNullable<unknown>>(
  left: readonly T[],
  right: readonly T[],
  areItemsEqual: (leftItem: T, rightItem: T) => boolean,
): boolean => {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (leftItem === undefined || rightItem === undefined) {
      return false;
    }
    if (!areItemsEqual(leftItem, rightItem)) {
      return false;
    }
  }

  return true;
};
