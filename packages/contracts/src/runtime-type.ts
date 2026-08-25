export const hasOwnKey = <Value extends object>(
  value: Value,
  key: PropertyKey,
): key is keyof Value => Object.hasOwn(value, key);
