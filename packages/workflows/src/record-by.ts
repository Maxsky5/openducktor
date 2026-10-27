/** A record with one value for each ID of a list that holds every ID of its type. */
export const recordBy = <Id extends string, Value>(
  ids: readonly Id[],
  read: (id: Id) => Value,
): Record<Id, Value> =>
  // SAFETY: callers pass a complete ID list, so the entries hold one value for each ID.
  Object.fromEntries(ids.map((id) => [id, read(id)])) as Record<Id, Value>;
