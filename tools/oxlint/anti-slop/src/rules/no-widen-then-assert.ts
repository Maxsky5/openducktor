import { defineRule } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
} from "../shared/dictionary-types.ts";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

function unwrapParentheses(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") current = current.expression;
  return current;
}

function unwrapTransparentExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = unwrapParentheses(expression);
  while (current.type === "TSNonNullExpression" || current.type === "TSSatisfiesExpression") {
    current = unwrapParentheses(current.expression);
  }
  return current;
}

function resolveVariable(
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

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
    ? definition.node
    : null;
}

function isStableConst(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
  return (
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const" &&
    variable.references.every((reference) => reference.init || !reference.isWrite())
  );
}

function hasKnownEvidence(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables = new Set<Variable>(),
): boolean {
  if (isKnownEvidenceExpression(expression)) return true;
  const unwrapped = unwrapTransparentExpression(expression);
  if (unwrapped.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visitedVariables.has(variable)) return false;
  const declarator = variableDeclarator(variable);
  if (declarator === null || declarator.init === null || !isStableConst(variable, declarator)) {
    return false;
  }
  visitedVariables.add(variable);
  return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
}

function isBroadBoundaryType(
  type: ESTree.TSType,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  const wideningTarget = classifyWideningTarget(type, createTypeEnvironment(type, visitorKeys));
  return (
    wideningTarget?.kind === "unknown" ||
    wideningTarget?.kind === "object" ||
    wideningTarget?.kind === "open dictionary" ||
    wideningTarget?.kind === "generic container"
  );
}

function variableHasBroadAnnotation(
  variable: Variable,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  return variable.identifiers.some((identifier) => {
    const annotation = identifier.typeAnnotation?.typeAnnotation;
    return annotation !== undefined && isBroadBoundaryType(annotation, visitorKeys);
  });
}

function isBroadBoundaryInput(
  sourceCode: SourceCode,
  variable: Variable,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  const identifier = variable.identifiers[0];
  if (
    identifier === undefined ||
    !variableHasBroadAnnotation(variable, visitorKeys) ||
    variable.references.some(
      (reference) =>
        reference.isWrite() &&
        !reference.init &&
        (reference.identifier.start !== identifier.start ||
          reference.identifier.end !== identifier.end),
    )
  ) {
    return false;
  }

  const declarator = variableDeclarator(variable);
  return (
    declarator === null ||
    declarator.init === null ||
    !hasKnownEvidence(sourceCode, declarator.init)
  );
}

function aliasedIdentifier(
  expression: ESTree.Expression,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): ESTree.IdentifierReference | null {
  let current = unwrapTransparentExpression(expression);
  if (current.type === "TSAsExpression" || current.type === "TSTypeAssertion") {
    if (!isBroadBoundaryType(current.typeAnnotation, visitorKeys)) return null;
    current = unwrapTransparentExpression(current.expression);
  }
  return current.type === "Identifier" ? current : null;
}

function aliasesBroadBoundaryInput(
  sourceCode: SourceCode,
  assertedIdentifier: ESTree.IdentifierReference,
  assertion: ESTree.TSAsExpression | ESTree.TSTypeAssertion,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  let variable = resolveVariable(sourceCode, assertedIdentifier);
  const visited = new Set<Variable>();
  let aliasCount = 0;

  while (variable !== null && !visited.has(variable)) {
    visited.add(variable);
    const declarator = variableDeclarator(variable);
    if (
      declarator !== null &&
      declarator.init !== null &&
      declarator.end < assertion.start &&
      isStableConst(variable, declarator)
    ) {
      const sourceIdentifier = aliasedIdentifier(declarator.init, visitorKeys);
      if (sourceIdentifier !== null) {
        aliasCount += 1;
        variable = resolveVariable(sourceCode, sourceIdentifier);
        continue;
      }
    }

    return aliasCount > 0 && isBroadBoundaryInput(sourceCode, variable, visitorKeys);
  }

  return false;
}

/** Detect local aliases that conceal a broad boundary input before a narrow assertion. */
export const noWidenThenAssertRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow laundering an accepted broad boundary input through local aliases before asserting it to a narrower type.",
    },
    messages: {
      widenThenAssert:
        'Binding "{{name}}" aliases a broad boundary input before asserting a narrower type. Parse or assert the boundary input directly, then keep the parsed owner type.',
    },
  },
  createOnce(context) {
    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
      const visitorKeys = context.sourceCode.visitorKeys;
      if (isBroadBoundaryType(node.typeAnnotation, visitorKeys)) return;
      const expression = unwrapTransparentExpression(node.expression);
      if (
        expression.type !== "Identifier" ||
        !aliasesBroadBoundaryInput(context.sourceCode, expression, node, visitorKeys)
      ) {
        return;
      }

      context.report({
        node,
        messageId: "widenThenAssert",
        data: { name: expression.name },
      });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
