export type RuntimeTypeName =
  | "bigint"
  | "boolean"
  | "function"
  | "number"
  | "object"
  | "string"
  | "symbol"
  | "undefined";

type RuntimeValue<Type extends RuntimeTypeName> = Type extends "bigint"
  ? bigint
  : Type extends "boolean"
    ? boolean
    : Type extends "function"
      ? (...args: never[]) => void
      : Type extends "number"
        ? number
        : Type extends "object"
          ? object | null
          : Type extends "string"
            ? string
            : Type extends "symbol"
              ? symbol
              : undefined;

type FunctionMembers<Value> = Value extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : never;

type RuntimeFunctionPart<Value> = [FunctionMembers<Value>] extends [never]
  ? (...args: never[]) => void
  : FunctionMembers<Value>;

type RuntimeObjectPart<Value> = [Extract<Value, object | null>] extends [never]
  ? object | null
  : Extract<Value, object | null>;

type RuntimePrimitivePart<Value, Type extends RuntimeTypeName> = [
  Extract<Value, RuntimeValue<Type>>,
] extends [never]
  ? RuntimeValue<Type>
  : Extract<Value, RuntimeValue<Type>>;

type RuntimeNarrow<Value, Type extends RuntimeTypeName> = Type extends "function"
  ? RuntimeFunctionPart<Value>
  : Type extends "object"
    ? RuntimeObjectPart<Value>
    : RuntimePrimitivePart<Value, Type>;

export const hasRuntimeType = <Value, Type extends RuntimeTypeName>(
  value: Value,
  type: Type,
): value is Value & RuntimeNarrow<Value, Type> => typeof value === type;

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
