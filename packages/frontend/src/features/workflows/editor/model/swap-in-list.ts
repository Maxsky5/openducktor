/** Swaps two items of a list. */
export const swapInList = <Item>(list: readonly Item[], left: number, right: number): Item[] => {
  const next = [...list];
  [next[left], next[right]] = [next[right]!, next[left]!];
  return next;
};
