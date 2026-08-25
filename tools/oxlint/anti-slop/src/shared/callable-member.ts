import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";
import { resolveVariable, singleVariableDeclarator } from "./global-reference.ts";
import { isStableBinding } from "./stable-binding.ts";
import { unwrapTransparentExpression } from "./transparent-expression.ts";

type MemberMatcher = (
  object: ESTree.Expression,
  objectPath: readonly string[],
  propertyName: string,
) => boolean;

function staticPropertyName(
  property: ESTree.Expression | ESTree.PrivateIdentifier,
  computed: boolean,
): string | null {
  if (!computed && property.type === "Identifier") return property.name;
  return computed && property.type === "Literal" && typeof property.value === "string"
    ? property.value
    : null;
}

function destructuredMember(pattern: ESTree.ObjectPattern, localName: string): string | null {
  for (const property of pattern.properties) {
    if (
      property.type !== "Property" ||
      property.value.type !== "Identifier" ||
      property.value.name !== localName
    ) {
      continue;
    }
    return staticPropertyName(property.key, property.computed);
  }
  return null;
}

function matchesStableExpression(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  matcher: (base: ESTree.Expression, path: readonly string[]) => boolean,
  path: readonly string[] = [],
  resolvingVariables: ReadonlySet<Variable> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (matcher(unwrapped, path)) return true;
  if (unwrapped.type === "MemberExpression" && unwrapped.object.type !== "Super") {
    const propertyName = staticPropertyName(unwrapped.property, unwrapped.computed);
    return (
      propertyName !== null &&
      matchesStableExpression(
        sourceCode,
        unwrapped.object,
        matcher,
        [propertyName, ...path],
        resolvingVariables,
      )
    );
  }
  if (unwrapped.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || resolvingVariables.has(variable)) return false;
  const declarator = singleVariableDeclarator(variable);
  if (declarator === null || declarator.init === null || !isStableBinding(variable, declarator)) {
    return false;
  }
  const nextResolving = new Set(resolvingVariables);
  nextResolving.add(variable);
  if (declarator.id.type === "Identifier") {
    return matchesStableExpression(sourceCode, declarator.init, matcher, path, nextResolving);
  }
  if (declarator.id.type !== "ObjectPattern") return false;
  const propertyName = destructuredMember(declarator.id, unwrapped.name);
  return (
    propertyName !== null &&
    matchesStableExpression(
      sourceCode,
      declarator.init,
      matcher,
      [propertyName, ...path],
      nextResolving,
    )
  );
}

/** Match a member reference directly or through stable local aliases and destructuring. */
export function isCallableMemberReference(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  matcher: MemberMatcher,
  resolvingVariables: ReadonlySet<Variable> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (unwrapped.type === "MemberExpression" && unwrapped.object.type !== "Super") {
    const propertyName = staticPropertyName(unwrapped.property, unwrapped.computed);
    return (
      propertyName !== null &&
      matchesStableExpression(
        sourceCode,
        unwrapped.object,
        (object, objectPath) => matcher(object, objectPath, propertyName),
        [],
        resolvingVariables,
      )
    );
  }
  if (unwrapped.type !== "Identifier") return false;

  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || resolvingVariables.has(variable)) return false;
  const declarator = singleVariableDeclarator(variable);
  if (declarator === null || declarator.init === null || !isStableBinding(variable, declarator)) {
    return false;
  }
  const nextResolvingVariables = new Set(resolvingVariables);
  nextResolvingVariables.add(variable);

  if (declarator.id.type === "ObjectPattern") {
    const propertyName = destructuredMember(declarator.id, unwrapped.name);
    return (
      propertyName !== null &&
      matchesStableExpression(
        sourceCode,
        declarator.init,
        (object, objectPath) => matcher(object, objectPath, propertyName),
        [],
        nextResolvingVariables,
      )
    );
  }
  if (declarator.id.type !== "Identifier") return false;

  return isCallableMemberReference(sourceCode, declarator.init, matcher, nextResolvingVariables);
}
