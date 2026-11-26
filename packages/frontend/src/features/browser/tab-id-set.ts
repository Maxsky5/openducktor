/** A copy of `ids` with `id`. */
export const withId = (ids: ReadonlySet<string>, id: string): ReadonlySet<string> =>
  new Set([...ids, id]);

/** A copy of `ids` without `id`. */
export const withoutId = (ids: ReadonlySet<string>, id: string): ReadonlySet<string> =>
  new Set([...ids].filter((candidate) => candidate !== id));
