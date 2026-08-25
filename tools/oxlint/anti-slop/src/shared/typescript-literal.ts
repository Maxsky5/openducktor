import type { PortableTSType } from "./portable-ast.ts";

export type DecodedTypeScriptLiteral =
  | { readonly kind: "bigint"; readonly text: string }
  | { readonly kind: "boolean"; readonly text: string }
  | { readonly kind: "number"; readonly propertyKey: number; readonly text: string }
  | { readonly kind: "string"; readonly propertyKey: string; readonly text: string };

export function decodeTypeScriptLiteral(
  literal: Extract<PortableTSType, { type: "TSLiteralType" }>["literal"],
): DecodedTypeScriptLiteral | null {
  if (literal.type === "Literal") {
    if ("bigint" in literal) return { kind: "bigint", text: literal.bigint };
    if (typeof literal.value === "string") {
      return { kind: "string", propertyKey: literal.value, text: literal.value };
    }
    if (typeof literal.value === "number") {
      return { kind: "number", propertyKey: literal.value, text: String(literal.value) };
    }
    if (typeof literal.value === "boolean") {
      return { kind: "boolean", text: String(literal.value) };
    }
    return null;
  }
  if (
    literal.type !== "UnaryExpression" ||
    (literal.operator !== "+" && literal.operator !== "-") ||
    literal.argument.type !== "Literal"
  ) {
    return null;
  }
  const argument = literal.argument;
  if ("bigint" in argument) {
    const text =
      literal.operator === "-" && argument.bigint !== "0" ? `-${argument.bigint}` : argument.bigint;
    return { kind: "bigint", text };
  }
  if (typeof argument.value !== "number") return null;
  const value = literal.operator === "-" ? -argument.value : argument.value;
  return { kind: "number", propertyKey: value, text: String(value) };
}
