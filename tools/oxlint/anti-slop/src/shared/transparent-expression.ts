import type { ESTree } from "@oxlint/plugins";

export function unwrapTransparentExpression(
  expression: ESTree.Expression,
  options: { includeTypeAssertions?: boolean } = {},
): ESTree.Expression {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression" ||
    (options.includeTypeAssertions === true &&
      (current.type === "TSAsExpression" || current.type === "TSTypeAssertion"))
  ) {
    current = current.expression;
  }
  return current;
}
