import { useState } from "react";

let keyCount = 0;
const newKey = (): string => `item-${(keyCount += 1)}`;

/**
 * The keys of a new list from the keys of the previous list. An item keeps the key of the same
 * unchanged item, so a moved or removed item keeps its row. A changed item takes the key of its
 * place, so a field that the user types in keeps its focus. A new place gets a new key.
 */
export const reconcileKeys = <Item>(
  previousItems: readonly Item[],
  previousKeys: readonly string[],
  items: readonly Item[],
  makeKey: () => string = newKey,
): string[] => {
  const used = new Set<number>();
  const matches = items.map((item) => {
    const index = previousItems.findIndex(
      (previous, candidate) => !used.has(candidate) && Object.is(previous, item),
    );
    if (index >= 0) used.add(index);
    return index;
  });
  return items.map((_, place) => {
    const match = matches[place]!;
    if (match >= 0) return previousKeys[match]!;
    if (place < previousKeys.length && !used.has(place)) {
      used.add(place);
      return previousKeys[place]!;
    }
    return makeKey();
  });
};

/** Each item with a key that stays with the item while the list changes. */
export const useStableKeys = <Item>(
  items: readonly Item[],
): readonly { readonly item: Item; readonly key: string }[] => {
  const [state, setState] = useState(() => ({ items, keys: items.map(() => newKey()) }));
  let keys = state.keys;
  if (state.items !== items) {
    keys = reconcileKeys(state.items, state.keys, items);
    setState({ items, keys });
  }
  return items.map((item, place) => ({ item, key: keys[place]! }));
};
