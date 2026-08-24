export type RuntimeTypeName =
  | "bigint"
  | "boolean"
  | "function"
  | "number"
  | "object"
  | "string"
  | "symbol"
  | "undefined";

export const hasOwnKey = <Value extends object>(
  value: Value,
  key: PropertyKey,
): key is keyof Value => Object.hasOwn(value, key);

export const runtimeTypeName = <Value>(value: Value): RuntimeTypeName => {
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "function") return "function";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "undefined") return "undefined";
  return "object";
};
