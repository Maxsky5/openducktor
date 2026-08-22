export type RuntimeTypeName =
  | "bigint"
  | "boolean"
  | "function"
  | "number"
  | "object"
  | "string"
  | "symbol"
  | "undefined";

type RuntimeTypeMap = {
  bigint: bigint;
  boolean: boolean;
  function: (...args: never[]) => never;
  number: number;
  object: object | null;
  string: string;
  symbol: symbol;
  undefined: undefined;
};

type ExistingFunction<Value> = Value extends (...args: infer Parameters) => infer Result
  ? (...args: Parameters) => Result
  : never;

type FunctionNarrow<Value> = [ExistingFunction<Value>] extends [never]
  ? RuntimeTypeMap["function"]
  : ExistingFunction<Value>;

type RuntimeTypeNarrow<Value, Type extends RuntimeTypeName> = Type extends "function"
  ? FunctionNarrow<Value>
  : RuntimeTypeMap[Type];

export const hasRuntimeType = <Value, Type extends RuntimeTypeName>(
  value: Value,
  type: Type,
): value is Value & RuntimeTypeNarrow<Value, Type> => typeof value === type;

export const runtimeTypeName = <Value>(value: Value): RuntimeTypeName => {
  if (hasRuntimeType(value, "bigint")) return "bigint";
  if (hasRuntimeType(value, "boolean")) return "boolean";
  if (hasRuntimeType(value, "function")) return "function";
  if (hasRuntimeType(value, "number")) return "number";
  if (hasRuntimeType(value, "string")) return "string";
  if (hasRuntimeType(value, "symbol")) return "symbol";
  if (hasRuntimeType(value, "undefined")) return "undefined";
  return "object";
};
