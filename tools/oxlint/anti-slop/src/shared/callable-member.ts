import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";
import { resolveVariable, singleVariableDeclarator } from "./global-reference.ts";
import { isStableBinding } from "./stable-binding.ts";
import { unwrapTransparentExpression } from "./transparent-expression.ts";

type MemberMatcher = (object: ESTree.Expression, propertyName: string) => boolean;

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
    return propertyName !== null && matcher(unwrapped.object, propertyName);
  }
  if (unwrapped.type !== "Identifier") return false;

  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || resolvingVariables.has(variable)) return false;
  const declarator = singleVariableDeclarator(variable);
  if (declarator === null || declarator.init === null || !isStableBinding(variable, declarator)) {
    return false;
  }

  if (declarator.id.type === "ObjectPattern") {
    const propertyName = destructuredMember(declarator.id, unwrapped.name);
    return propertyName !== null && matcher(declarator.init, propertyName);
  }
  if (declarator.id.type !== "Identifier") return false;

  const nextResolvingVariables = new Set(resolvingVariables);
  nextResolvingVariables.add(variable);
  return isCallableMemberReference(sourceCode, declarator.init, matcher, nextResolvingVariables);
}
