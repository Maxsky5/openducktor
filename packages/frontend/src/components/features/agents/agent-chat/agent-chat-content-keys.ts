/** Native content has no per-entry ID. Keep equal entries distinct across re-projection. */
export const buildContentEntries = <Value>(
  values: readonly Value[],
  identity: (value: Value) => string,
): Array<{ value: Value; key: string }> => {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const base = identity(value);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { value, key: JSON.stringify([base, occurrence]) };
  });
};
