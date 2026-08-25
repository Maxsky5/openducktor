import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

export function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function isUnshadowedGlobalIdentifier(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  name: string,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier" || expression.name !== name) return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

export function isGlobalObjectReference(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  name: string,
): boolean {
  if (isUnshadowedGlobalIdentifier(sourceCode, expression, name)) return true;
  if (
    expression.type !== "MemberExpression" ||
    expression.object.type === "Super" ||
    !isUnshadowedGlobalIdentifier(sourceCode, expression.object, "globalThis")
  ) {
    return false;
  }
  return expression.computed
    ? expression.property.type === "Literal" && expression.property.value === name
    : expression.property.type === "Identifier" && expression.property.name === name;
}
