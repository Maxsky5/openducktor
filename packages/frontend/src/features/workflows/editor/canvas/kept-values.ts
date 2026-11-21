/**
 * Keepers give back the previous object while its content stays the same. An edit makes new
 * canvas objects for every box and line, so without them React Flow renders each box and line
 * again, and the line routes run again for a keystroke that moves nothing. The content compares as
 * JSON, since canvas items are plain data.
 */

type Kept<Value> = { readonly value: Value; readonly text: string };

/** A keeper of one value, such as the box positions or the line inputs of the router. */
export const createValueKeeper = <Value>() => {
  let kept: Kept<Value> | null = null;
  return (value: Value): Value => {
    const text = JSON.stringify(value);
    if (kept?.text === text) return kept.value;
    kept = { value, text };
    return value;
  };
};

/**
 * A keeper of a list of canvas items with IDs. Each unchanged item keeps its object, and an
 * unchanged list keeps its array.
 */
export const createItemKeeper = <Item extends { readonly id: string }>() => {
  let kept = new Map<string, Kept<Item>>();
  let keptList: Item[] = [];
  return (items: readonly Item[]): Item[] => {
    const next = new Map<string, Kept<Item>>();
    let changed = items.length !== keptList.length;
    const list = items.map((item, index) => {
      const text = JSON.stringify(item);
      const previous = kept.get(item.id);
      const entry = previous?.text === text ? previous : { value: item, text };
      next.set(item.id, entry);
      if (entry.value !== keptList[index]) changed = true;
      return entry.value;
    });
    kept = next;
    if (changed) keptList = list;
    return keptList;
  };
};
