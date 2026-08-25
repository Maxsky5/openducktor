import type { PortableNode } from "./portable-ast.ts";

type TypeAssertion = Extract<PortableNode, { type: "TSAsExpression" | "TSTypeAssertion" }>;

export function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}
