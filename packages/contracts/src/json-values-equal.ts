export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonValue[]
  | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Compares two JSON values by structure. Object key order does not count. An object key with
 * an `undefined` value counts as absent, as in `JSON.stringify`.
 */
export const jsonValuesEqual = (left: JsonValue, right: JsonValue): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  let leftKeyCount = 0;
  for (const key in left) {
    if (left[key] === undefined) continue;
    if (!jsonValuesEqual(left[key], right[key])) return false;
    leftKeyCount += 1;
  }
  return leftKeyCount === definedKeyCount(right);
};

/** Matches a plain JSON object, with the `Object` prototype or no prototype. */
export const isJsonObject = (value: JsonValue): value is JsonObject => {
  if (value === null || value === undefined || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const definedKeyCount = (value: JsonObject): number => {
  let count = 0;
  for (const key in value) if (value[key] !== undefined) count += 1;
  return count;
};
